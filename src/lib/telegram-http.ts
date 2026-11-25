import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type TelegramMethod = "sendMessage" | "sendPhoto" | "getMe" | "getWebhookInfo" | "setWebhook";

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
    const args = [
      "--disable", "--ipv4", "--noproxy", "*", "--proto", "=https",
      "--silent", "--connect-timeout", "5", "--max-time", String(timeoutMs / 1000),
      "--write-out", "\n%{http_code}", "--config", "-",
    ];

    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        "curl", args, { encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true },
        (error, stdout) => {
          if (error) {
            reject(new Error(`Telegram curl failed (${error.code ?? "unknown"}).`));
            return;
          }
          resolve(stdout);
        },
      );
      child.stdin?.on("error", reject);
      child.stdin?.end(config);
    });

    const suffix = /\n([1-5]\d{2})$/.exec(output);
    if (!suffix) {
      throw new Error("Invalid Telegram HTTP response.");
    }
    const status = Number(suffix[1]);
    return { ok: status >= 200 && status < 300, status, body: output.slice(0, suffix.index) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
