import childProcess from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type TelegramMethod = "sendMessage" | "sendPhoto" | "getMe" | "getWebhookInfo" | "setWebhook";

function runCurl(config: string, connectTimeoutMs: number, timeoutMs: number) {
  const args = [
    "--disable", "--ipv4", "--noproxy", "*", "--proto", "=https",
    "--silent", "--connect-timeout", String(connectTimeoutMs / 1000),
    "--max-time", String(timeoutMs / 1000),
    "--write-out", "\n%{http_code} %{time_connect} %{time_appconnect} %{size_request}",
    "--config", "-",
  ];

  return new Promise<{ output: string; code?: string | number }>((resolve, reject) => {
    const child = childProcess.execFile(
      "curl", args, { encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout) => resolve({ output: stdout, code: error ? error.code ?? "unknown" : undefined }),
    );
    child.stdin?.on("error", reject);
    child.stdin?.end(config);
  });
}

export async function postTelegramWithCurl(
  token: string,
  method: TelegramMethod,
  body: string | FormData,
  timeoutMs: number,
) {
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Invalid Telegram bot token format.");
  }

  const url = `https://api.telegram.org/bot${token}/${method}`;
  const request = new Request(url, {
    method: "POST",
    body,
    headers: typeof body === "string" ? { "Content-Type": "application/json" } : undefined,
  });

  const directory = await mkdtemp(join(tmpdir(), "1vpn-telegram-"));
  const payloadPath = join(directory, "request");
  try {
    await writeFile(payloadPath, Buffer.from(await request.arrayBuffer()), { mode: 0o600 });

    // Pass credentials and request data outside the process arguments.
    const config = [
      `url = ${JSON.stringify(url)}`,
      `header = ${JSON.stringify(`Content-Type: ${request.headers.get("content-type")}`)}`,
      `data-binary = ${JSON.stringify(`@${payloadPath}`)}`,
      "",
    ].join("\n");

    const deadline = performance.now() + timeoutMs;
    for (let attempt = 1; ; attempt += 1) {
      const remainingMs = Math.max(1, Math.ceil(deadline - performance.now()));
      const connectTimeoutMs = Math.min(attempt < 3 ? 2500 : 5000, remainingMs);
      const { code, output } = await runCurl(config, connectTimeoutMs, remainingMs);
      const metrics = /\n(\d{3}) (\d+\.\d+) (\d+\.\d+) (\d+)$/.exec(output);
      const status = Number(metrics?.[1]);

      if (code === undefined) {
        if (!metrics || status < 100 || status > 599) {
          throw new Error(`${method}: invalid Telegram HTTP response.`);
        }
        return { ok: status >= 200 && status < 300, status, body: output.slice(0, metrics.index) };
      }

      const tcpSeconds = Number(metrics?.[2]);
      const tlsSeconds = Number(metrics?.[3]);
      const bytesSent = Number(metrics?.[4]);
      // A timeout after sending a request does not tell us whether Telegram applied it.
      if (code === 28 && status === 0 && tcpSeconds === 0 && tlsSeconds === 0 && bytesSent === 0 &&
          attempt < 3 && performance.now() < deadline) {
        continue;
      }

      const phase = !metrics ? "phase unavailable" : tcpSeconds === 0 ? "before TCP connect"
        : tlsSeconds === 0 ? "during TLS handshake" : "after TLS handshake";
      throw new Error(`${method}: Telegram curl failed (${code}, ${phase}, attempts=${attempt}).`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
