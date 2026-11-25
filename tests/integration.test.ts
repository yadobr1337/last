import assert from "node:assert/strict";
import childProcess, { spawnSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { after, before, test } from "node:test";
import { Role } from "@prisma/client";
import { POST as processCron } from "@/app/api/cron/process/route";
import { POST as yooKassaWebhook } from "@/app/api/payments/yookassa/webhook/route";
import { POST as register } from "@/app/api/register/route";
import { POST as telegramWebhook } from "@/app/api/telegram/webhook/route";
import { authOptions } from "@/lib/auth";
import { adjustBalanceByAdmin, changeBillingSettings, changeDeviceLimit, creditBalance, grantDaysToAllUsers, runLifecycleSweep,
  setBanState, settleUserBilling, syncUserLifecycle, topUpBalance } from "@/lib/billing";
import { db, writeTransaction } from "@/lib/db";
import { consumeEmailCode, issueEmailCode } from "@/lib/email-codes";
import { env } from "@/lib/env";
import { parseRubleAmount } from "@/lib/money";
import { broadcastTelegramMessage, notifyUserOnce, processNotifications } from "@/lib/notifications";
import { runProvisioningSweep } from "@/lib/provisioning";
import { takeRateLimit } from "@/lib/rate-limit";
import { MS_IN_DAY } from "@/lib/site";
import { createSmtpTransport, smtpFailure } from "@/lib/smtp-transport";
import { sendTelegramMessage, verifyTelegramAuth } from "@/lib/telegram";
import { postTelegramWithCurl } from "@/lib/telegram-http";
import { issueTelegramLinkToken } from "@/lib/telegram-link";
import { telegramAnnouncement, telegramReplyMarkup, telegramTemplates } from "@/lib/telegram-templates";
import { withWorkLease } from "@/lib/work-lease";
import { applyYooKassaPayment } from "@/lib/yookassa";
import { applyTestMigrations, verifyMigrationAndBackup } from "./test-database.mjs";

before(async () => {
  applyTestMigrations(process.env.DATABASE_URL!);
  await db.$queryRaw`PRAGMA journal_mode = WAL`;
  await db.systemSettings.create({
    data: { id: "default", pricePerDayKopeks: 100, defaultsVersion: 1 },
  });
});

after(() => db.$disconnect());

function userFixture(overrides: Parameters<typeof db.user.create>[0]["data"] = { email: "" }) {
  return db.user.create({ data: { ...overrides, email: overrides.email || `${randomUUID()}@example.test` } });
}

async function paymentFixture(userId?: string) {
  const user = userId ? await db.user.findUniqueOrThrow({ where: { id: userId } }) : await userFixture();
  const providerPaymentId = randomUUID();
  const local = await db.payment.create({
    data: { userId: user.id, amountKopeks: 1201, method: "bank_card", description: "Fixture", providerPaymentId },
  });
  return {
    local,
    user,
    remote: {
      id: providerPaymentId, status: "succeeded" as const, paid: true, test: false,
      amount: { value: "12.01", currency: "RUB" as const },
      recipient: { account_id: "123456" },
      metadata: { localPaymentId: local.id, userId: user.id },
    },
  };
}

function webhook(id: string) {
  return yooKassaWebhook(new Request("http://local.test/webhook", {
    method: "POST",
    body: JSON.stringify({ type: "notification", event: "payment.succeeded", object: { id } }),
  }));
}

async function assertCredit(fixture: Awaited<ReturnType<typeof paymentFixture>>, expected: number) {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: fixture.local.id } });
  const user = await db.user.findUniqueOrThrow({ where: { id: fixture.user.id } });
  assert.equal(user.balanceKopeks, expected * 1201);
  assert.equal(Boolean(payment.creditedAt), Boolean(expected));
  assert.equal(await db.balanceTransaction.count({ where: { userId: user.id, type: "TOPUP" } }), expected);
}

test("YooKassa: successful payment uses provider status and duplicate webhook does not credit twice", async (t) => {
  const fixture = await paymentFixture();
  t.mock.method(globalThis, "fetch", async (input: string) => {
    assert.equal(input, `https://api.yookassa.ru/v3/payments/${fixture.remote.id}`);
    return Response.json(fixture.remote);
  });
  assert.equal((await webhook(fixture.remote.id)).status, 200);
  assert.equal((await webhook(fixture.remote.id)).status, 200);
  await assertCredit(fixture, 1);
});

test("YooKassa: two simultaneous webhook requests result in one credit", async (t) => {
  const fixture = await paymentFixture();
  t.mock.method(globalThis, "fetch", async () => Response.json(fixture.remote));
  const responses = await Promise.all([webhook(fixture.remote.id), webhook(fixture.remote.id)]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  await assertCredit(fixture, 1);
});

test("YooKassa: invalid provider status, amount, recipient and local order are rejected", async (t) => {
  const fixture = await paymentFixture();
  await assert.rejects(applyYooKassaPayment({
    ...fixture.remote, amount: { value: "12.02", currency: "RUB" },
  }), /does not match/);
  await assert.rejects(applyYooKassaPayment({
    ...fixture.remote, recipient: { account_id: "654321" },
  }), /Unexpected/);
  await assert.rejects(applyYooKassaPayment({
    ...fixture.remote, metadata: { ...fixture.remote.metadata, userId: "different-user" },
  }), /does not match/);
  await assert.rejects(applyYooKassaPayment({ ...fixture.remote, id: randomUUID() }), /does not match/);
  t.mock.method(globalThis, "fetch", async () => Response.json({
    ...fixture.remote, status: "pending", paid: false,
  }));
  assert.equal((await webhook(fixture.remote.id)).status, 409);
  await assertCredit(fixture, 0);
});

test("YooKassa: database error rolls back payment and balance, retry succeeds", async () => {
  const fixture = await paymentFixture((await userFixture({ id: "fault-user", email: "" })).id);
  await db.$executeRaw`
    CREATE TRIGGER reject_test_credit BEFORE INSERT ON "BalanceTransaction"
    WHEN NEW."userId" = 'fault-user' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END
  `;
  try {
    await assert.rejects(applyYooKassaPayment(fixture.remote));
    await assertCredit(fixture, 0);
  } finally {
    await db.$executeRaw`DROP TRIGGER reject_test_credit`;
  }
  await applyYooKassaPayment(fixture.remote);
  await assertCredit(fixture, 1);
});

test("YooKassa: abrupt process exit before commit leaves payment recoverable", async () => {
  const fixture = await paymentFixture();
  const child = spawnSync(process.execPath, ["--import", "./tests/local-environment.mjs", "--import", "tsx",
    "tests/crash-before-payment-commit.ts"], {
    env: { ...process.env, SITE1VPN_TEST_CHILD: "1", SITE1VPN_TEST_PAYMENT_ID: fixture.local.id },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(child.status, 78, child.stderr);
  await assertCredit(fixture, 0);
  await applyYooKassaPayment(fixture.remote);
  await assertCredit(fixture, 1);
});

test("production disables demo credits and YooKassa test objects even with configuration flags", async (t) => {
  const fixture = await paymentFixture();
  const oldMode = process.env.NODE_ENV;
  const oldFlag = process.env.PAYMENTS_AUTO_APPROVE;
  t.after(() => {
    Reflect.set(process.env, "NODE_ENV", oldMode);
    if (oldFlag === undefined) delete process.env.PAYMENTS_AUTO_APPROVE;
    else process.env.PAYMENTS_AUTO_APPROVE = oldFlag;
  });
  Reflect.set(process.env, "NODE_ENV", "production");
  process.env.PAYMENTS_AUTO_APPROVE = "true";
  await assert.rejects(topUpBalance({ userId: fixture.user.id, amountKopeks: 1201, description: "Demo" }), /disabled/);
  await assert.rejects(applyYooKassaPayment({ ...fixture.remote, test: true }), /environment/);
  await assertCredit(fixture, 0);
});

test("billing: duplicate settlement and competing cron never charge the same period twice", async () => {
  const start = new Date(Date.now() - MS_IN_DAY);
  const user = await userFixture({ email: "", balanceKopeks: 75, billingStartedAt: start, lastBillingAt: start });
  await Promise.all([runLifecycleSweep(), runLifecycleSweep()]);
  const settled = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(settled.balanceKopeks, 0);
  assert.equal(settled.subscriptionEndedAt?.getTime(), start.getTime() + MS_IN_DAY * 0.75);
  const ledger = await db.balanceTransaction.findMany({ where: { userId: user.id } });
  assert.deepEqual(ledger.map(({ amountKopeks }) => amountKopeks), [-75]);
});

test("billing: simultaneous credit and debit preserve balance and ledger", async () => {
  const start = new Date(Date.now() - MS_IN_DAY);
  const user = await userFixture({ email: "", balanceKopeks: 500, billingStartedAt: start, lastBillingAt: start });
  const payment = await paymentFixture(user.id);
  await Promise.all([
    writeTransaction((tx) => settleUserBilling(user.id, tx, new Date(start.getTime() + MS_IN_DAY))),
    applyYooKassaPayment(payment.remote),
  ]);
  const result = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(result.balanceKopeks, 1601);
  const ledger = await db.balanceTransaction.findMany({ where: { userId: user.id } });
  assert.deepEqual(ledger.map(({ amountKopeks }) => amountKopeks).sort((a, b) => a - b), [-100, 1201]);
});

test("billing: changing device count settles old rate before recording new limit", async () => {
  const start = new Date(Date.now() - MS_IN_DAY);
  const user = await userFixture({ email: "", balanceKopeks: 500, billingStartedAt: start, lastBillingAt: start, hwidDeviceLimit: 2 });
  await changeDeviceLimit(user.id, 5, "test-admin");
  const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(updated.hwidDeviceLimit, 5);
  assert.equal(updated.balanceKopeks, 300);
  const settled = await writeTransaction((tx) => settleUserBilling(user.id, tx,
    new Date(updated.lastBillingAt!.getTime() + MS_IN_DAY / 2)));
  assert.equal(settled.balanceKopeks, 50);
});

test("billing: precision is invariant under partitioning a day into small periods", async () => {
  assert.equal(parseRubleAmount("1,01"), 101);
  assert.equal(parseRubleAmount("-0.09"), -9);
  assert.throws(() => parseRubleAmount("0.005"));
  const start = new Date(Date.now() - MS_IN_DAY);
  const user = await userFixture({ email: "", balanceKopeks: 201, billingStartedAt: start, lastBillingAt: start });
  const split = [1, 7, 372, 74_490, 718_210, MS_IN_DAY - 7, MS_IN_DAY];
  for (const elapsed of split) {
    await writeTransaction((tx) => settleUserBilling(user.id, tx, new Date(start.getTime() + elapsed)));
  }
  const result = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(result.balanceKopeks, 101);
  assert.equal(result.billingCarryMicros, 0n);
  assert.equal(result.billingRemainder, 0n);
});

test("billing: global price change settles outstanding time first", async () => {
  const start = new Date(Date.now() - MS_IN_DAY);
  const user = await userFixture({ email: "", balanceKopeks: 900, billingStartedAt: start, lastBillingAt: start });
  try {
    await changeBillingSettings({ pricePerDayKopeks: 200, defaultHwidDeviceLimit: 1 }, "test-admin");
    const snapshot = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(snapshot.balanceKopeks, 800);
    const result = await writeTransaction((tx) => settleUserBilling(user.id, tx,
      new Date(snapshot.lastBillingAt!.getTime() + MS_IN_DAY / 2)));
    assert.equal(result.balanceKopeks, 700);
  } finally {
    await db.systemSettings.update({ where: { id: "default" }, data: { pricePerDayKopeks: 100 } });
  }
});

test("billing: ten gifted days cover one, two and five devices", async () => {
  const devices = [1, 2, 5];
  const users = await Promise.all(devices.map((hwidDeviceLimit) => userFixture({ email: "", hwidDeviceLimit })));
  const gift = { days: 10, description: "Test gift", actor: "test-admin", requestId: randomUUID() };
  await grantDaysToAllUsers(gift);
  await grantDaysToAllUsers(gift);
  for (const [index, user] of users.entries()) {
    const snapshot = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(snapshot.balanceKopeks, 1_000 * devices[index]);
    const transaction = await db.balanceTransaction.findFirstOrThrow({ where: { userId: user.id } });
    assert.deepEqual(transaction.metadata, { actor: "test-admin" });
  }
});

test("expired task lease recovers, concurrent task sees one owner", async () => {
  await db.workLease.create({ data: { key: "task-test", owner: "old-process", expiresAt: new Date(0) } });
  let runs = 0;
  const work = () => withWorkLease("task-test", 20_000, async () => {
    runs++;
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  await Promise.all([work(), work()]);
  assert.equal(runs, 1);
  assert.equal(await db.workLease.count({ where: { key: "task-test" } }), 0);
});

test("missing cron secret rejects unauthenticated access", async () => {
  const response = await processCron(new Request("http://local.test/cron", { method: "POST" }));
  assert.equal(response.status, 401);
});

test("stale JWT cannot retain privilege after deletion or ban", async () => {
  const jwt = authOptions.callbacks!.jwt!;
  const user = await userFixture({ email: "", role: Role.ADMIN, publicId: "11111111" });
  const token = { id: user.id, role: Role.ADMIN, authVersion: 0 };
  await db.user.update({ where: { id: user.id }, data: { role: Role.USER } });
  const refresh = (candidate: typeof token) => jwt({
    token: { ...candidate }, account: null, user: undefined!, trigger: undefined,
  });
  assert.equal((await refresh(token)).role, Role.USER);
  await db.user.update({ where: { id: user.id }, data: { authVersion: { increment: 1 } } });
  assert.deepEqual(await refresh(token), {});
  await setBanState(user.id, true, "test-admin");
  assert.deepEqual(await refresh({ ...token, authVersion: 1 }), {});
  await db.user.delete({ where: { id: user.id } });
  assert.deepEqual(await refresh({ ...token, authVersion: 1 }), {});
});

test("Telegram widget signs the last name and accepts the proof only once", async (t) => {
  const auth = { id: "1234567001", first_name: "Local", last_name: "Test", auth_date: String(Math.floor(Date.now() / 1000)) };
  const data = Object.entries(auth).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const key = createHash("sha256").update(env.TELEGRAM_BOT_TOKEN!).digest();
  const hash = createHmac("sha256", key).update(data).digest("hex");
  assert.equal((await verifyTelegramAuth({ ...auth, hash })).ok, true);
  assert.equal((await verifyTelegramAuth({ ...auth, id: "99999", hash })).ok, false);
  assert.equal((await verifyTelegramAuth({ ...auth, last_name: "Changed", hash })).ok, false);

  const provider = authOptions.providers.find((candidate) =>
    candidate.type === "credentials" && candidate.options.id === "telegram");
  assert.ok(provider?.type === "credentials" && provider.options.authorize);
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true }));
  const request = { method: "POST", headers: {}, body: {}, query: {} };
  const user = await provider.options.authorize({ ...auth, hash }, request);
  assert.equal(user?.telegramId, auth.id);
  assert.equal(await provider.options.authorize({ ...auth, hash }, request), null);
});

test("Telegram curl retries TCP timeouts within its attempt limit and stops after sending a request", async (t) => {
  const tcpTimeout = { code: 28, output: "\n000 0.000000 0.000000 0" };
  const response = { code: undefined, output: '{"ok":true}\n200 0.050000 0.100000 125' };
  const replies = [tcpTimeout, tcpTimeout, response];
  const curl = t.mock.method(childProcess, "execFile", (
    _file: string,
    _args: string[],
    _options: object,
    callback: (error: Error | null, stdout: string) => void,
  ) => {
    const reply = replies.shift();
    assert.ok(reply, "Unexpected curl invocation");
    const process = new childProcess.ChildProcess();
    process.stdin = new Writable({
      write(_chunk, _encoding, done) {
        done();
        const error = reply.code ? Object.assign(new Error("curl timed out"), { code: reply.code }) : null;
        queueMicrotask(() => callback(error, reply.output));
      },
    });
    return process;
  });

  const send = () => postTelegramWithCurl("12345:offline-mock", "sendMessage", "{}", 10_000);
  assert.deepEqual(await send(), { ok: true, status: 200, body: '{"ok":true}' });
  assert.equal(curl.mock.callCount(), 3);

  replies.push(tcpTimeout, tcpTimeout, tcpTimeout);
  await assert.rejects(send(), /28, before TCP connect, attempts=3/);
  assert.equal(curl.mock.callCount(), 6);

  replies.push({ code: 28, output: "\n000 0.050000 0.100000 125" });
  await assert.rejects(send(), /28, after TLS handshake, attempts=1/);
  assert.equal(curl.mock.callCount(), 7);
});

test("SmartCaptcha protects email registration and rejects failed, foreign and unavailable proofs", async (t) => {
  const email = "captcha-fixture@example.test";
  const password = "offline-mock-password";
  const settings = await db.systemSettings.findUniqueOrThrow({ where: { id: "default" } });
  await db.systemSettings.update({ where: { id: settings.id }, data: { captchaEnabled: true } });
  const host = new URL(env.NEXTAUTH_URL!).host;
  const validate = (captchaToken?: string) => register(new Request("http://" + host + "/api/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "192.0.2.1" },
    body: JSON.stringify({ email, password, captchaToken }),
  }));

  const fetchMock = t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://smartcaptcha.cloud.yandex.ru/validate");
    assert.equal(init.method, "POST");
    const body = init.body as URLSearchParams;
    assert.equal(body.get("secret"), env.SMARTCAPTCHA_SERVER_KEY);
    assert.equal(body.get("ip"), "192.0.2.1");
    const token = body.get("token");
    if (token === "service-error") return new Response("", { status: 502 });
    if (token === "wrong-host") return Response.json({ status: "ok", host: "elsewhere.example.test" });
    if (token === "accepted") return Response.json({ status: "ok", host });
    return Response.json({ status: "failed" });
  });

  try {
    assert.equal((await validate()).status, 400);
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.equal((await validate("rejected")).status, 400);
    assert.equal((await validate("wrong-host")).status, 400);
    assert.equal((await validate("service-error")).status, 503);
    assert.equal(await db.user.findUnique({ where: { email } }), null);
    assert.equal((await validate("accepted")).status, 200);
    assert.ok(await db.user.findUnique({ where: { email } }));
  } finally {
    await db.systemSettings.update({ where: { id: settings.id }, data: { captchaEnabled: settings.captchaEnabled } });
  }
});

test("Yandex SMTP uses the selected IPv4 address and verifies TLS against the SMTP hostname", async () => {
  const config = {
    SMTP_HOST: "smtp.yandex.ru",
    SMTP_CONNECT_HOST: "localhost",
    SMTP_IP_FAMILY: "4",
    SMTP_PORT: 465,
    SMTP_USER: "smtp-fixture@yandex.ru",
    SMTP_PASS: "fixture-app-password",
    SMTP_FROM_EMAIL: "smtp-fixture@yandex.ru",
  };
  const implicit = await createSmtpTransport(config);
  try {
    const options = Reflect.get(implicit.transport.transporter, "options");
    assert.equal(options.host, "127.0.0.1");
    assert.equal(options.tls.servername, "smtp.yandex.ru");
    assert.equal(options.secure, true);
  } finally {
    implicit.transport.close();
  }

  const startTls = await createSmtpTransport({ ...config, SMTP_PORT: 587, SMTP_SECURE: "false" });
  try {
    const options = Reflect.get(startTls.transport.transporter, "options");
    assert.equal(options.secure, false);
    assert.equal(options.requireTLS, true);
  } finally {
    startTls.transport.close();
  }
  await assert.rejects(createSmtpTransport({ ...config, SMTP_SECURE: "false" }), /SMTP_SECURE=true/);
  await assert.rejects(createSmtpTransport({ ...config, SMTP_PASS: "" }), /пароль приложения/);
  const authFailure = smtpFailure(Object.assign(new Error("SMTP response with private data"), {
    code: "EAUTH", command: "AUTH PLAIN", responseCode: 535,
  }));
  assert.equal(authFailure.status, "smtp_auth_error");
  assert.equal(authFailure.responseCode, 535);
  assert.doesNotMatch(JSON.stringify(authFailure), /private data/);
});

test("a code accepted by SMTP matches the stored proof and can be used once", async () => {
  const messages: string[] = [];
  const envelope: string[] = [];
  const smtpServer = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.setTimeout(2000, () => socket.destroy());
    socket.write("220 localhost ESMTP test\r\n");
    let pending = "";
    let messageLines: string[] | undefined;
    socket.on("data", (chunk) => {
      const lines = (pending + chunk).split("\r\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (messageLines) {
          if (line === ".") {
            messages.push(messageLines.join("\r\n"));
            messageLines = undefined;
            socket.write("250 Accepted\r\n");
          } else {
            messageLines.push(line);
          }
        } else if (/^(EHLO|HELO) /.test(line)) {
          socket.write("250 localhost\r\n");
        } else if (/^(MAIL FROM|RCPT TO):/.test(line)) {
          envelope.push(line);
          socket.write("250 OK\r\n");
        } else if (line === "DATA") {
          messageLines = [];
          socket.write("354 Send message\r\n");
        } else if (line === "QUIT") {
          socket.end("221 Bye\r\n");
        } else {
          socket.write("500 Unexpected command\r\n");
        }
      }
    });
  });
  smtpServer.listen(0, "127.0.0.1");
  await once(smtpServer, "listening");
  const address = smtpServer.address();
  assert.ok(address && typeof address !== "string");
  const settings = {
    SMTP_HOST: "localhost",
    SMTP_CONNECT_HOST: undefined,
    SMTP_IP_FAMILY: "4",
    SMTP_PORT: address.port,
    SMTP_SECURE: "false",
    SMTP_FROM_EMAIL: "sender@example.test",
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
  } as const;
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, Reflect.get(env, key)]));
  Object.assign(env, settings);
  try {
    const identifier = "verify-email:fixture:smtp@example.test";
    await issueEmailCode({
      identifier,
      email: "SMTP@example.test",
      subject: "1VPN email verification",
      title: "Email verification",
      description: "Enter this confirmation code in your personal account settings.",
    });
    assert.deepEqual(envelope, ["MAIL FROM:<sender@example.test>", "RCPT TO:<smtp@example.test>"]);
    assert.equal(messages.length, 1);
    const plain = /Content-Type: text\/plain[^\r\n]*\r\nContent-Transfer-Encoding: ([^\r\n]+)\r\n\r\n([\s\S]+?)\r\n--/i.exec(messages[0]);
    assert.ok(plain);
    const body = plain[1] === "base64" ? Buffer.from(plain[2], "base64").toString("utf8") : plain[2].replace(/=\r\n/g, "");
    const code = /: (\d{6})\r?\n/.exec(body)?.[1];
    assert.ok(code);
    assert.equal(await consumeEmailCode(identifier, code), true);
    assert.equal(await consumeEmailCode(identifier, code), false);
  } finally {
    Object.assign(env, previous);
    await new Promise<void>((resolve) => smtpServer.close(() => resolve()));
  }
});

test("email code is consumed once under concurrency and repeats are rejected", async () => {
  const identifier = "reset-password:fixture@example.test";
  const code = "501234";
  const token = createHmac("sha256", env.NEXTAUTH_SECRET).update(`email-code\0${identifier}\0${code}`).digest("hex");
  await db.verificationToken.create({ data: { identifier, token, expires: new Date(Date.now() + 60_000) } });
  assert.equal(await consumeEmailCode(identifier, "000000"), false);
  const result = await Promise.all([consumeEmailCode(identifier, code), consumeEmailCode(identifier, code)]);
  assert.deepEqual(result.sort(), [false, true]);
  assert.equal(await consumeEmailCode(identifier, code), false);
});

test("persistent rate limit enforces attempt count across simultaneous requests", async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => takeRateLimit("attempt-test", "identity", 3, 60_000)));
  assert.equal(results.filter(Boolean).length, 3);
});

test("Telegram notification is sent once after concurrent reservation", async (t) => {
  const user = await userFixture({ email: "", telegramId: "12345" });
  let sends = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.match(url, /^https:\/\/api\.telegram\.org\//);
    const payload = JSON.parse(String(init.body));
    assert.match(payload.text, /^🛡 1VPN · Уведомление\n\n<b>Старое уведомление<\/b>/);
    assert.deepEqual(payload.reply_markup, telegramReplyMarkup("balance", env.NEXTAUTH_URL));
    sends++;
    return Response.json({ ok: true });
  });
  const event = { user, type: "TOPUP" as const, cycleKey: "queue:test", message: "<b>1VPN</b>\n<b>Старое уведомление</b>" };
  await Promise.all([notifyUserOnce(event), notifyUserOnce(event)]);
  await Promise.all([processNotifications(), processNotifications()]);
  const record = await db.notificationEvent.findFirstOrThrow({ where: { userId: user.id } });
  assert.equal(sends, 1);
  assert.equal(record.success, true);
  assert.equal(record.attempts, 1);
});

test("Telegram admin credit is queued before VPN synchronization and delivered once with the committed balance", async (t) => {
  const squad = await db.squad.create({
    data: { name: "Credit sync fixture", slug: "credit-sync-fixture", memberLimit: 15, remnawaveInternalSquadUuid: randomUUID() },
  });
  const user = await userFixture({ email: "", telegramId: "23456", squadId: squad.id, telegramBotConfirmedAt: new Date() });
  const oldBase = env.REMNAWAVE_BASE_URL;
  const oldToken = env.REMNAWAVE_API_TOKEN;
  env.REMNAWAVE_BASE_URL = "https://panel.example.test";
  env.REMNAWAVE_API_TOKEN = "mock-token";
  t.after(() => { env.REMNAWAVE_BASE_URL = oldBase; env.REMNAWAVE_API_TOKEN = oldToken; });

  let queuedBeforeVpn = false;
  const delivered: Array<{ chat_id: string; text: string; reply_markup: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (new URL(url).hostname === "panel.example.test") {
      const [credit, entry] = await Promise.all([
        db.balanceTransaction.findFirst({ where: { userId: user.id, amountKopeks: 30_025 } }),
        db.notificationEvent.findFirst({ where: { userId: user.id, type: "TOPUP" } }),
      ]);
      queuedBeforeVpn = Boolean(credit && entry?.nextAttemptAt);
      return Response.json({}, { status: 503 });
    }
    delivered.push(JSON.parse(String(init.body)));
    return Response.json({ ok: true });
  });

  const updated = await adjustBalanceByAdmin({ userId: user.id, amountKopeks: 30_025, description: "Fixture", actor: "test-admin" });
  assert.equal(updated.balanceKopeks, 30_025);
  assert.equal(queuedBeforeVpn, true);
  await Promise.all([processNotifications(), processNotifications()]);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].chat_id, user.telegramId);
  assert.match(delivered[0].text, /Администратор зачислил: 300,25\s₽\nТекущий баланс: 300,25\s₽/);
  assert.deepEqual(delivered[0].reply_markup, telegramReplyMarkup("balance", env.NEXTAUTH_URL));
  const event = await db.notificationEvent.findFirstOrThrow({ where: { userId: user.id, type: "TOPUP" } });
  assert.equal(event.success, true);
  assert.equal(event.deliveryText, null);
});

test("Telegram webhook shows the configured account button and confirms a link once", async (t) => {
  const user = await userFixture();
  const token = await issueTelegramLinkToken(user.id);
  const sender = { id: 34567, first_name: "Fixture", username: "fixture_bot_user" };
  const messages: Array<{ text: string; reply_markup: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    messages.push(JSON.parse(String(init.body)));
    return Response.json({ ok: true });
  });
  const post = (text: string, secret = env.TELEGRAM_WEBHOOK_SECRET!) => telegramWebhook(new Request("http://local.test", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify({ message: { text, chat: { id: sender.id, type: "private" }, from: sender } }),
  }));

  assert.equal((await post("/start", "invalid")).status, 401);
  assert.equal((await post("/start")).status, 200);
  assert.equal((await post(`/start link_${token}`)).status, 200);
  assert.equal((await post(`/start link_${token}`)).status, 200);
  const confirmed = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(confirmed.telegramId, String(sender.id));
  assert.ok(confirmed.telegramBotConfirmedAt);
  assert.deepEqual(messages.map(({ text }) => text), [
    telegramTemplates.start(), telegramTemplates.linked(), telegramTemplates.linkExpired(),
  ]);
  assert.deepEqual(messages[1].reply_markup, telegramReplyMarkup("telegram", env.NEXTAUTH_URL));
});

test("Telegram templates format amounts, use existing destinations and escape administrator content", () => {
  const copies = [
    [telegramTemplates.linkRecorded(), "Telegram добавлен"],
    [telegramTemplates.linkTaken(), "Telegram уже привязан"],
    [telegramTemplates.linkUsed(), "Не удалось подтвердить привязку"],
    [telegramTemplates.topUp(30_000, 45_025), "Текущий баланс: 450,25"],
    [telegramTemplates.gift(2, "<b>& подарок</b>"), "&lt;b&gt;&amp; подарок&lt;/b&gt;"],
    [telegramTemplates.lowBalance(4_900, MS_IN_DAY), "1 день"],
    [telegramTemplates.expired(24), "24 часа"],
    [telegramTemplates.deleted(), "Ссылка подписки удалена"],
    [telegramTemplates.ban(true), "приостановлен администратором"],
    [telegramTemplates.ban(false), "Ограничение снято"],
  ];
  for (const [copy, expected] of copies) {
    assert.ok(copy.includes(expected));
    assert.match(copy, /^\S+ 1VPN · [^\n]+\n\n<b>[^\n]+<\/b>\n\n/);
    assert.doesNotMatch(copy, /<a\s|━━/);
  }
  assert.doesNotMatch(telegramTemplates.lowBalance(5, 0), /хватит/);
  assert.equal(telegramReplyMarkup("topUp", "https://example.test")?.inline_keyboard[0][0].url, "https://example.test/dashboard#top-up");
  assert.equal(telegramReplyMarkup("site", "javascript:alert(1)"), undefined);
  assert.equal(telegramReplyMarkup("site", "https://user:pass@example.test"), undefined);
});

test("Telegram broadcast preserves long text, line breaks, links, photo and a single button per recipient", async (t) => {
  const text = "<b>Текст</b> & 1\nhttps://example.test/?a=1&b=2\n" + "Длинная строка 🚀\n".repeat(245);
  const parts = telegramAnnouncement(text, true);
  const plainText = (part: string) => part.replace(/<\/?b>/g, "").replace(/&(amp|lt|gt);/g, (_, entity: "amp" | "lt" | "gt") =>
    ({ amp: "&", lt: "<", gt: ">" })[entity],
  );
  assert.ok(plainText(parts[0]).length <= 1024);
  assert.ok(parts.slice(1).every((part) => plainText(part).length <= 4096));
  assert.equal(plainText(parts.join("")).split("\n\n").slice(2).join("\n\n"), text);
  assert.match(parts[0], /&lt;b&gt;Текст&lt;\/b&gt; &amp; 1\nhttps:\/\/example.test\/\?a=1&amp;b=2/);
  assert.equal(telegramAnnouncement("1", false)[0], "📢 1VPN · Объявление\n\n<b>Новости сервиса</b>\n\n1");

  const expected = await db.user.count({ where: { telegramId: { not: null } } });
  const captions: string[] = [];
  const chunks: Array<{ text: string; reply_markup?: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/sendPhoto")) {
      assert.ok(init.body instanceof FormData);
      assert.ok(init.body.get("photo") instanceof File);
      assert.equal(init.body.has("reply_markup"), false);
      captions.push(String(init.body.get("caption")));
    } else {
      chunks.push(JSON.parse(String(init.body)));
    }
    return Response.json({ ok: true });
  });
  const photo = new File([new Uint8Array([1, 2, 3])], "test.jpg", { type: "image/jpeg" });
  const result = await broadcastTelegramMessage({ text, photo, actor: "mock-admin" });
  assert.equal(result?.delivered, expected);
  assert.equal(result?.failed, 0);
  assert.deepEqual(captions, Array(expected).fill(parts[0]));
  assert.equal(chunks.length, expected * (parts.length - 1));
  assert.equal(chunks.filter(({ reply_markup }) => reply_markup).length, expected);
  assert.deepEqual(chunks.at(-1)?.reply_markup, telegramReplyMarkup("site", env.NEXTAUTH_URL));
});

test("Telegram delivery reports API failures without recording provider text", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user. Untrusted provider details",
  }));
  assert.deepEqual(await sendTelegramMessage("123", telegramTemplates.start(), "telegram"), {
    ok: false, status: 403, error: "Telegram HTTP 403 (bot blocked by recipient)",
  });
});

test("Remnawave recovers from lost create response and keeps issued subscription link on update", async (t) => {
  const oldBase = env.REMNAWAVE_BASE_URL;
  const oldToken = env.REMNAWAVE_API_TOKEN;
  env.REMNAWAVE_BASE_URL = "https://panel.example.test";
  env.REMNAWAVE_API_TOKEN = "mock-token";
  t.after(() => { env.REMNAWAVE_BASE_URL = oldBase; env.REMNAWAVE_API_TOKEN = oldToken; });
  const squad = await db.squad.create({
    data: { name: "Integration squad", slug: "integration-squad", memberLimit: 15, remnawaveInternalSquadUuid: randomUUID() },
  });
  const user = await userFixture({ email: "", squadId: squad.id, hwidDeviceLimit: 2 });
  await writeTransaction((tx) => creditBalance(tx, {
    userId: user.id, amountKopeks: 1000, description: "Test credit", notificationKey: "vpn-test",
  }));

  const uuid = randomUUID();
  const date = new Date().toISOString();
  let creates = 0;
  let disables = 0;
  let remote: Record<string, unknown> | undefined;
  const subscriptionUrl = "https://vpn.example.test/sub/stable";
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(new URL(url).hostname, "panel.example.test");
    if (init.method === "GET") return remote ? Response.json({ response: remote }) : new Response(null, { status: 404 });
    const body = JSON.parse(String(init.body));
    if (init.method === "POST" && !new URL(url).pathname.includes("disable")) {
      creates++;
      remote = {
        ...body, uuid, id: 1, shortUuid: "stable", status: "ACTIVE", telegramId: null, description: null,
        tag: null, externalSquadUuid: null, trojanPassword: "mock", vlessUuid: uuid, ssPassword: "mock",
        subRevokedAt: null, lastTrafficResetAt: null, createdAt: date, updatedAt: date, subscriptionUrl,
        activeInternalSquads: [{ uuid: squad.remnawaveInternalSquadUuid, name: squad.name }],
        userTraffic: { usedTrafficBytes: 0, lifetimeUsedTrafficBytes: 0, onlineAt: null, firstConnectedAt: null, lastConnectedNodeUuid: null },
      };
      throw new Error("Simulated loss after successful create");
    }
    assert.ok(remote);
    if (init.method === "PATCH") {
      assert.equal(body.uuid, uuid);
      remote = { ...remote, expireAt: body.expireAt, hwidDeviceLimit: body.hwidDeviceLimit, status: body.status,
        subscriptionUrl: "https://vpn.example.test/sub/alternate" };
    } else {
      disables++;
      remote.status = "DISABLED";
    }
    return Response.json({ response: remote });
  });

  await syncUserLifecycle(user.id);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).vpnProvisionState, "ERROR");
  await syncUserLifecycle(user.id);
  const active = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(active.vpnProvisionState, "ACTIVE");
  assert.equal(active.remnawaveUserUuid, uuid);
  await changeDeviceLimit(user.id, 3);
  assert.equal(remote?.hwidDeviceLimit, 3);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).subscriptionUrl, active.subscriptionUrl);
  await setBanState(user.id, true, "test-admin");
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).vpnProvisionState, "DISABLED");
  assert.equal(creates, 1);
  assert.equal(disables, 1);
});

test("Aeza order is reserved before request, lost response is reconciled without repeat purchase", async (t) => {
  const keys = {
    AUTO_PROVISION_ENABLED: "true", AUTO_PROVISION_DRY_RUN: "false",
    AUTO_PROVISION_TARGETS: "test|Test|NL|nd-test|nd-test|100",
    AUTO_PROVISION_BATCH_SIZE: 1, AEZA_API_TOKEN: "mock", TIMEWEB_CLOUD_TOKEN: "mock",
    REMNAWAVE_BASE_URL: "https://panel.example.test", REMNAWAVE_API_TOKEN: "mock",
    AUTO_PROVISION_CERTBOT_EMAIL: "test@example.test",
    AUTO_PROVISION_REMNANODE_SECRET_KEY: "mock-only-node-key",
    AUTO_PROVISION_SSH_PRIVATE_KEY_PATH: "/nonexistent", AEZA_ORDER_CURRENCY: "RUB",
    AEZA_MAX_DAILY_SPEND_MINOR: 500_000, AEZA_MAX_DAILY_ORDERS: 1,
  } as const;
  const previous = Object.fromEntries(Object.keys(keys).map((key) => [key, env[key as keyof typeof keys]]));
  Object.assign(env, keys);
  t.after(() => { Object.assign(env, previous); });
  const job = await db.provisioningJob.create({
    data: { locationKey: "aeza-test-op", locationName: "Fixture", countryCode: "NL", nodeName: "nd-fixture",
      subdomain: "nd-fixture", fqdn: "nd-fixture.example.test", productId: "100" },
  });
  let posts = 0;
  let visible = false;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    assert.equal(new URL(url).hostname, "core.aeza.net");
    if (path.endsWith("/price")) return Response.json({ totalPrice: "100.00", currency: "RUB" });
    if (init.method === "POST") {
      posts++;
      assert.equal((await db.provisioningJob.findUniqueOrThrow({ where: { id: job.id } })).status, "ORDER_UNCERTAIN");
      throw new Error("Response lost after provider accepted order");
    }
    return Response.json({ items: visible ? [{ name: job.nodeName, id: 123 }] : [] });
  });
  const first = await runProvisioningSweep("test-admin");
  assert.equal(first.ok, false);
  assert.equal(posts, 1);
  await runProvisioningSweep("test-admin");
  assert.equal(posts, 1);
  visible = true;
  await runProvisioningSweep("test-admin");
  const result = await db.provisioningJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(result.status, "SERVER_ORDERED");
  assert.equal(result.serverId, "123");
  assert.equal(posts, 1);

  await t.test("Timeweb updates DNS in the same zone that was read", async (dnsTest) => {
    const ip = "203.0.113.20";
    const zone = "example.test";
    const target = `nd-fixture.${zone}`;
    const oldZone = env.TIMEWEB_DOMAIN;
    env.TIMEWEB_DOMAIN = zone;
    dnsTest.after(() => { env.TIMEWEB_DOMAIN = oldZone; });
    await db.provisioningJob.update({
      where: { id: job.id }, data: { status: "DNS_PENDING", serverIp: ip },
    });
    let updates = 0;
    dnsTest.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      const path = new URL(url);
      assert.equal(path.hostname, "api.timeweb.cloud");
      if (init.method === "PATCH") {
        updates++;
        assert.equal(path.pathname, "/api/v1/domains/example.test/dns-records/123");
        assert.deepEqual(JSON.parse(String(init.body)), { type: "A", subdomain: target, value: ip, ttl: 600 });
        return Response.json({});
      }
      assert.equal(path.pathname, "/api/v1/domains/example.test/dns-records");
      return Response.json({ meta: { total: 1 }, dns_records: [
        { id: 123, type: "A", ttl: 300, data: { subdomain: target, value: "203.0.113.21" } },
      ] });
    });
    assert.equal((await runProvisioningSweep("test-admin")).ok, true);
    assert.equal(updates, 1);
    const updated = await db.provisioningJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(updated.status, "REMNAWAVE_PENDING");
  });
});

test("backup captures committed WAL and restores legacy user, payment and ledger before additive upgrade", async () => {
  const root = mkdtempSync(join(tmpdir(), "site1vpn-backup-test-"));
  try {
    const result = await verifyMigrationAndBackup(join(root, "legacy.db"), join(root, "restored.db"));
    assert.deepEqual(result, {
      integrity: "ok", foreignKeys: 0, balance: 1201, payment: 1, ledger: 1201, originalColumns: 0,
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
