import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { applyTestMigrations } from "./test-database.mjs";
import { runBrowserSmoke } from "./browser-smoke.mjs";

const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const { port } = listener.address();
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const root = mkdtempSync(join(tmpdir(), "site1vpn-http-"));
const databaseUrl = `file:${join(root, "smoke.db").replaceAll("\\", "/")}`;
applyTestMigrations(databaseUrl);
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const password = "local-fixture-password";
const ownUrl = "https://vpn.example.test/sub/owned-smoke-link";
const otherUrl = "https://vpn.example.test/sub/other-smoke-link";
const browserEmail = "browser@example.test";
const browserAdmin = "browser-admin@example.test";
const browserSubscription = "https://vpn.example.test/sub/browser-fixture";
const requireLocal = createRequire(import.meta.url);
let child;
let output = "";

function request(path, options) {
  return fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(10_000), ...options });
}

function cookies(response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function login(email) {
  const csrf = await request("/api/auth/csrf");
  const { csrfToken } = await csrf.json();
  const callback = await request("/api/auth/callback/credentials", {
    method: "POST",
    headers: { cookie: cookies(csrf) },
    body: new URLSearchParams({ csrfToken, email, password, json: "true", callbackUrl: "/dashboard" }),
  });
  const cookie = cookies(callback);
  assert.match(cookie, /next-auth\.session-token=/, await callback.text());
  return cookie;
}

try {
  const passwordHash = await bcrypt.hash(password, 4);
  await prisma.user.createMany({ data: [
    { id: "http-own", email: "own@example.test", passwordHash, balanceKopeks: 900,
      billingStartedAt: new Date(), lastBillingAt: new Date(), subscriptionUrl: ownUrl },
    { id: "http-other", email: "other@example.test", passwordHash, subscriptionUrl: otherUrl },
    { id: "http-admin", email: "admin@example.test", passwordHash, role: "ADMIN" },
    { id: "browser-user", email: browserEmail, passwordHash, balanceKopeks: 90000, hwidDeviceLimit: 1,
      billingStartedAt: new Date(), lastBillingAt: new Date(), subscriptionUrl: browserSubscription, vpnProvisionState: "ACTIVE" },
    { id: "browser-admin", email: browserAdmin, passwordHash, role: "ADMIN" },
  ] });
  await prisma.balanceTransaction.create({ data: {
    userId: "browser-user", type: "TOPUP", amountKopeks: 90000, description: "Тестовое пополнение",
  } });
  await prisma.payment.create({ data: {
    id: "smoke-payment", userId: "browser-user", amountKopeks: 90000, method: "sbp",
    description: "Тестовый заказ", status: "SUCCEEDED",
  } });

  child = spawn(process.execPath, [requireLocal.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    env: {
      ...process.env,
      NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: databaseUrl, NEXTAUTH_URL: origin, NEXTAUTH_SECRET: "isolated-http-smoke-secret",
      AUTO_PROVISION_ENABLED: "false", PAYMENTS_AUTO_APPROVE: "true",
      CRON_SECRET: "", YOOKASSA_SHOP_ID: "", YOOKASSA_SECRET_KEY: "", YOOKASSA_WEBHOOK_SECRET: "",
      REMNAWAVE_BASE_URL: "", REMNAWAVE_API_TOKEN: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_WEBHOOK_SECRET: "",
      AEZA_API_TOKEN: "", TIMEWEB_CLOUD_TOKEN: "", SMTP_HOST: "", HCAPTCHA_SECRET_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-12_000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-12_000); });

  let ready = false;
  for (let attempt = 0; attempt < 80 && child.exitCode === null; attempt++) {
    const health = await request("/api/health").catch(() => null);
    if (health?.ok) { ready = true; break; }
    await delay(250);
  }
  assert.ok(ready, output);
  assert.equal((await request("/")).status, 200);
  assert.equal((await request("/api/cron/process", { method: "POST" })).status, 401);
  assert.match((await request("/admin")).headers.get("location"), /\/login$/);

  const userCookie = await login("own@example.test");
  const ownResponse = await request("/dashboard?userId=http-other", { headers: { cookie: userCookie } });
  assert.equal(ownResponse.status, 200);
  const markup = await ownResponse.text();
  assert.ok(markup.includes(ownUrl));
  assert.ok(!markup.includes(otherUrl));
  assert.match((await request("/admin", { headers: { cookie: userCookie } })).headers.get("location"), /\/dashboard$/);
  await prisma.user.update({ where: { id: "http-own" }, data: { isBanned: true } });
  assert.match((await request("/dashboard", { headers: { cookie: userCookie } })).headers.get("location"), /\/login$/);

  const adminCookie = await login("admin@example.test");
  assert.equal((await request("/admin", { headers: { cookie: adminCookie } })).status, 200);
  await prisma.user.delete({ where: { id: "http-admin" } });
  assert.match((await request("/admin", { headers: { cookie: adminCookie } })).headers.get("location"), /\/login$/);

  const malformedRegister = await request("/api/register", { method: "POST", body: "invalid-json" });
  assert.equal(malformedRegister.status, 400);
  const registered = await request("/api/register", {
    method: "POST", body: JSON.stringify({ email: "new@example.test", password }),
  });
  assert.equal(registered.status, 200, await registered.text());
  assert.equal((await request("/dashboard", { headers: { cookie: await login("new@example.test") } })).status, 200);
  const reset = await request("/api/auth/password-reset/request", {
    method: "POST", body: JSON.stringify({ email: "unknown@example.test" }),
  });
  assert.equal(reset.status, 200);
  assert.deepEqual(await reset.json(), { ok: true });
  console.log("PASS HTTP: registration, login, private subscription, ban, admin role, deleted admin session, reset request and cron.");
  if (process.env.SITE1VPN_BROWSER_EXE) {
    await runBrowserSmoke(process.env.SITE1VPN_BROWSER_EXE, origin, root, {
      email: browserEmail, admin: browserAdmin, subscription: browserSubscription, password,
      screenshotDir: process.env.SITE1VPN_SCREENSHOT_DIR,
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: browserEmail } });
    assert.equal(user.hwidDeviceLimit, 2);
    assert.equal(user.isBanned, false, "Cancelling the confirmation preserves account access");
    const gift = await prisma.balanceTransaction.findFirst({
      where: { userId: user.id, description: "Obsidian QA gift", type: "ADMIN_ADJUSTMENT" },
    });
    assert.equal(gift?.amountKopeks, 10600, "Gift days use the saved tariff and device limit");
    const settings = await prisma.systemSettings.findUniqueOrThrow({ where: { id: "default" } });
    assert.equal(settings.maintenanceEnabled, true);
    assert.match(await (await request("/")).text(), /Obsidian QA maintenance/);
    assert.equal((await request("/admin", { headers: { cookie: await login(browserAdmin) } })).status, 200);
  }
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  await prisma.$disconnect();
  for (const name of ["smoke.db", "smoke.db-wal", "smoke.db-shm"]) {
    rmSync(join(root, name), { force: true, maxRetries: 5, retryDelay: 200 });
  }
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    const profile = join(root, "browser-profile");
    if (process.platform !== "win32" || !["EPERM", "EBUSY"].includes(error.code) ||
        !String(error.path).startsWith(profile + "\\")) throw error;
    console.warn("Windows kept a temporary Edge profile cache after shutdown. The test database was removed.");
  }
}
