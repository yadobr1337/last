import { z } from "zod";
import { postTelegramWithCurl } from "../src/lib/telegram-http";

type WebhookMethod = "getMe" | "getWebhookInfo" | "setWebhook";

async function callTelegram<T>(
  token: string,
  method: WebhookMethod,
  schema: z.ZodType<T>,
  params: Record<string, unknown> = {},
) {
  const response = await postTelegramWithCurl(token, method, JSON.stringify(params), 15_000);
  if (!response.ok) {
    throw new Error(`${method}: Telegram вернул HTTP ${response.status}.`);
  }

  const result = z.object({ ok: z.literal(true), result: schema }).safeParse(
    JSON.parse(response.body) as unknown,
  );
  if (!result.success) {
    throw new Error(`${method}: неожиданный ответ Telegram.`);
  }
  return result.data.result;
}

function parseUrl(value: string, base?: string) {
  return URL.canParse(value, base) ? new URL(value, base) : null;
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  const siteUrl = process.env.NEXTAUTH_URL?.trim();
  if (!token || !secret || !username || !siteUrl) {
    throw new Error(
      "Заполни TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, NEXT_PUBLIC_TELEGRAM_BOT_USERNAME и NEXTAUTH_URL в .env.",
    );
  }
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET должен содержать от 16 до 256 букв, цифр, дефисов или подчёркиваний.");
  }

  const webhook = parseUrl("/api/telegram/webhook", siteUrl);
  if (!webhook || webhook.protocol !== "https:" || webhook.username || webhook.password) {
    throw new Error("Задай публичный HTTPS-адрес сайта в NEXTAUTH_URL.");
  }

  const bot = await callTelegram(token, "getMe", z.object({ username: z.string() }));
  if (bot.username.toLowerCase() !== username.toLowerCase()) {
    throw new Error(`Токен принадлежит @${bot.username}. Проверь имя бота и токен в .env.`);
  }

  const webhookInfo = z.object({ url: z.string() });
  const current = await callTelegram(token, "getWebhookInfo", webhookInfo);
  if (current.url && current.url.replace(/\/+$/, "") !== webhook.href) {
    throw new Error(`У @${bot.username} уже есть другой вебхук (${parseUrl(current.url)?.hostname ?? "неизвестный адрес"}).`);
  }

  await callTelegram(token, "setWebhook", z.literal(true), {
    url: webhook.href,
    secret_token: secret,
    allowed_updates: ["message"],
  });
  const updated = await callTelegram(token, "getWebhookInfo", webhookInfo);
  if (updated.url !== webhook.href) {
    throw new Error("Telegram вернул другой адрес вебхука после настройки.");
  }
  console.log(`Вебхук @${bot.username} подключён к ${webhook.href}`);
}

main().catch((error: unknown) => {
  // SyntaxError from JSON.parse can include a fragment of the upstream response.
  console.error(error instanceof Error && !(error instanceof SyntaxError)
    ? error.message
    : "Не удалось прочитать ответ Telegram.");
  process.exitCode = 1;
});
