import { env } from "@/lib/env";
import { postTelegramWithCurl } from "@/lib/telegram-http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

type TelegramAuthPayload = {
  id: string;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
};

const miniAppUser = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  first_name: z.string().min(1).max(256),
  username: z.string().max(64).optional(),
  photo_url: z.string().max(2048).optional(),
});

function buildDataCheckString(payload: Record<string, string | undefined>) {
  return Object.entries(payload)
    .filter(([key, value]) => key !== "hash" && value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

async function hmacSha256Raw(key: BufferSource, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
}

function toHex(signature: ArrayBuffer) {
  return Array.from(new Uint8Array(signature))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function isFresh(authDate: string) {
  const age = Math.floor(Date.now() / 1000) - Number(authDate);
  return /^\d{1,12}$/.test(authDate) && age >= -30 && age <= 5 * 60;
}

function hashesMatch(computed: string, supplied: string) {
  return /^[a-f\d]{64}$/.test(supplied) &&
    timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(supplied, "hex"));
}

export async function verifyTelegramAuth(payload: TelegramAuthPayload) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: "Telegram bot token is not configured." } as const;
  }

  if (!isFresh(payload.auth_date) || !/^[1-9]\d{0,15}$/.test(payload.id) ||
      !payload.first_name || payload.first_name.length > 256 ||
      Object.values(payload).some((value) => value && (value.length > 2048 || /[\r\n]/.test(value)))) {
    return { ok: false, error: "Telegram auth payload is expired." } as const;
  }

  const secretHash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(env.TELEGRAM_BOT_TOKEN),
  );

  const signature = await hmacSha256Raw(secretHash, buildDataCheckString(payload));
  const computedHash = toHex(signature);

  if (!hashesMatch(computedHash, payload.hash)) {
    return { ok: false, error: "Telegram auth hash is invalid." } as const;
  }

  return {
    ok: true,
    data: {
      id: payload.id,
      firstName: payload.first_name,
      username: payload.username ?? null,
      photoUrl: payload.photo_url ?? null,
    },
  } as const;
}

export async function verifyTelegramMiniAppAuth(initData: string) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: "Telegram bot token is not configured." } as const;
  }

  const params = new URLSearchParams(initData);
  if (initData.length > 8192 || new Set(params.keys()).size !== params.size) {
    return { ok: false, error: "Telegram Mini App payload is invalid." } as const;
  }
  const hash = params.get("hash");
  const authDate = params.get("auth_date");
  const userRaw = params.get("user");

  if (!hash || !authDate || !userRaw) {
    return { ok: false, error: "Telegram Mini App payload is incomplete." } as const;
  }

  if (!isFresh(authDate)) {
    return { ok: false, error: "Telegram Mini App payload is expired." } as const;
  }

  const entries = Array.from(params.entries())
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = await hmacSha256Raw(
    new TextEncoder().encode("WebAppData"),
    env.TELEGRAM_BOT_TOKEN,
  );
  const signature = await hmacSha256Raw(secretKey, entries);
  const computedHash = toHex(signature);

  if (!hashesMatch(computedHash, hash)) {
    return { ok: false, error: "Telegram Mini App hash is invalid." } as const;
  }

  let data: unknown;
  try {
    data = JSON.parse(userRaw);
  } catch {
    return { ok: false, error: "Telegram Mini App user payload is invalid." } as const;
  }

  const parsed = miniAppUser.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: "Telegram Mini App user payload is incomplete." } as const;
  }
  const user = parsed.data;

  return {
    ok: true,
    data: {
      id: String(user.id),
      firstName: user.first_name,
      username: user.username ?? null,
      photoUrl: user.photo_url ?? null,
    },
  } as const;
}

function getSiteUrl() {
  return env.NEXTAUTH_URL?.replace(/\/+$/, "") ?? null;
}

function decorateTelegramMessage(text: string) {
  const content = text.replace(/^<b>1VPN<\/b>\s*\n?/, "").trim();
  const siteUrl = getSiteUrl();
  const footer = siteUrl ? `\n\n━━━━━━━━━━\n<a href="${siteUrl}">Открыть сайт 1VPN →</a>` : "";
  return `✨ <b>1VPN</b>\n<i>Уведомление сервиса</i>\n\n${content}${footer}`;
}

function buildReplyMarkup() {
  const siteUrl = getSiteUrl();
  return siteUrl
    ? {
        inline_keyboard: [[{ text: "Открыть 1VPN", url: siteUrl }]],
      }
    : undefined;
}

export function escapeTelegramHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function postTelegram(
  token: string,
  method: "sendMessage" | "sendPhoto",
  body: string | FormData,
  timeoutMs: number,
) {
  if (env.TELEGRAM_USE_CURL_IPV4 === "true") {
    return postTelegramWithCurl(token, method, body, timeoutMs);
  }

  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: typeof body === "string" ? { "Content-Type": "application/json" } : undefined,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function sendTelegramMessage(chatId: string, text: string) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: "Telegram bot token is not configured." } as const;
  }

  try {
    const response = await postTelegram(
      env.TELEGRAM_BOT_TOKEN,
      "sendMessage",
      JSON.stringify({
        chat_id: chatId,
        text: decorateTelegramMessage(text),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: buildReplyMarkup(),
      }),
      10_000,
    );

    if (!response.ok) {
      return { ok: false, error: `Telegram HTTP ${response.status}`, status: response.status } as const;
    }

    return { ok: true } as const;
  } catch {
    return {
      ok: false,
      error: "Telegram request timed out or connection failed.",
    } as const;
  }
}

export async function sendTelegramPhoto(chatId: string, text: string, photo: File) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: "Telegram bot token is not configured." } as const;
  }

  try {
    const body = new FormData();
    body.set("chat_id", chatId);
    body.set("caption", decorateTelegramMessage(text).slice(0, 1024));
    body.set("parse_mode", "HTML");
    body.set("photo", photo, photo.name || "broadcast.jpg");

    const replyMarkup = buildReplyMarkup();
    if (replyMarkup) {
      body.set("reply_markup", JSON.stringify(replyMarkup));
    }

    const response = await postTelegram(env.TELEGRAM_BOT_TOKEN, "sendPhoto", body, 20_000);

    if (!response.ok) {
      return { ok: false, error: `Telegram HTTP ${response.status}`, status: response.status } as const;
    }

    return { ok: true } as const;
  } catch {
    return {
      ok: false,
      error: "Telegram photo request timed out or connection failed.",
    } as const;
  }
}
