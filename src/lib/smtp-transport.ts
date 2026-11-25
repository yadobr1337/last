import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import nodemailer from "smtp-nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { z } from "zod";

type SmtpEnv = Partial<Record<
  "SMTP_HOST" | "SMTP_CONNECT_HOST" | "SMTP_IP_FAMILY" | "SMTP_SECURE" |
  "SMTP_USER" | "SMTP_PASS" | "SMTP_FROM_EMAIL" | "SMTP_FROM_NAME", string
>> & { SMTP_PORT?: string | number };

class SmtpConfigurationError extends Error {}

export async function createSmtpTransport(settings: SmtpEnv | NodeJS.ProcessEnv) {
  const host = settings.SMTP_HOST?.trim();
  const fromEmail = settings.SMTP_FROM_EMAIL?.trim();
  if (!host || !fromEmail) {
    throw new SmtpConfigurationError("Укажи SMTP_HOST и SMTP_FROM_EMAIL в .env.");
  }
  if (!z.email().safeParse(fromEmail).success) {
    throw new SmtpConfigurationError("Укажи корректный адрес в SMTP_FROM_EMAIL.");
  }

  if (settings.SMTP_SECURE && !["true", "false"].includes(settings.SMTP_SECURE)) {
    throw new SmtpConfigurationError("Укажи true или false в SMTP_SECURE.");
  }
  const port = Number(settings.SMTP_PORT || (settings.SMTP_SECURE === "true" ? 465 : 587));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SmtpConfigurationError("Укажи допустимый порт в SMTP_PORT.");
  }
  const secure = settings.SMTP_SECURE ? settings.SMTP_SECURE === "true" : port === 465;
  const yandex = /^smtp\.(yandex\.(ru|com)|ya\.ru)$/i.test(host);
  if (yandex && ((port === 465 && !secure) || (port === 587 && secure))) {
    throw new SmtpConfigurationError("Для Яндекса укажи SMTP_SECURE=true на порту 465 или SMTP_SECURE=false на порту 587.");
  }

  const user = settings.SMTP_USER?.trim();
  const pass = settings.SMTP_PASS;
  if (Boolean(user) !== Boolean(pass) || (yandex && !user)) {
    throw new SmtpConfigurationError("Укажи SMTP_USER и SMTP_PASS. Для Яндекса нужен пароль приложения «Почта».");
  }

  const familyMode = settings.SMTP_IP_FAMILY?.trim() || "auto";
  if (familyMode !== "auto" && familyMode !== "4" && familyMode !== "6") {
    throw new SmtpConfigurationError("Укажи auto, 4 или 6 в SMTP_IP_FAMILY.");
  }
  const family = familyMode === "auto" ? undefined : Number(familyMode);
  let target = settings.SMTP_CONNECT_HOST?.trim() || host;
  if (family) {
    const targetFamily = isIP(target);
    if (targetFamily && targetFamily !== family) {
      throw new SmtpConfigurationError("SMTP_CONNECT_HOST и SMTP_IP_FAMILY указывают разные семейства IP.");
    }
    // Pass the resolved address explicitly. TLS still verifies the SMTP hostname.
    if (!targetFamily) target = (await lookup(target, { family })).address;
  }

  const servername = isIP(host) ? undefined : host;
  const auth = user && pass ? { user, pass } : undefined;
  const options: SMTPTransport.Options & { servername?: string; forceAuth?: boolean } = {
    host: target,
    port,
    secure,
    requireTLS: !secure && (yandex || process.env.NODE_ENV === "production"),
    servername,
    tls: { servername },
    dnsTimeout: 5_000,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    auth,
    forceAuth: Boolean(auth),
  };
  return {
    transport: nodemailer.createTransport(options),
    from: { address: fromEmail, name: settings.SMTP_FROM_NAME?.trim() || "1VPN" },
  };
}

export function smtpFailure(error: unknown): {
  status: "smtp_missing" | "smtp_auth_error" | "smtp_connection_error" | "send_error";
  hint: string;
  code?: string;
  command?: string;
  responseCode?: number;
  timeout?: string;
} {
  if (error instanceof SmtpConfigurationError) {
    return { status: "smtp_missing", hint: error.message };
  }
  if (error instanceof Error && error.message === "SMTP is not configured.") {
    return { status: "smtp_missing", hint: "Укажи SMTP_HOST и SMTP_FROM_EMAIL в .env." };
  }

  const details = error as { code?: unknown; command?: unknown; responseCode?: unknown; timeoutType?: unknown } | null;
  const code = typeof details?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(details.code) ? details.code : undefined;
  const command = typeof details?.command === "string" && /^(CONN|EHLO|HELO|STARTTLS|AUTH( [A-Z0-9-]+)?|MAIL FROM|RCPT TO|DATA|API)$/.test(details.command)
    ? details.command : undefined;
  const responseCode = typeof details?.responseCode === "number" ? details.responseCode : undefined;
  const timeout = typeof details?.timeoutType === "string" && /^[A-Z_]+_TIMEOUT$/.test(details.timeoutType)
    ? details.timeoutType : undefined;
  const diagnostic = { code, command, responseCode, timeout };

  if (code === "EAUTH" || command?.startsWith("AUTH") || responseCode === 535) {
    return { ...diagnostic, status: "smtp_auth_error", hint: "Проверь полный логин, пароль приложения и доступ для почтовых программ." };
  }
  if (code === "ETLS" || code?.includes("CERT") || command === "STARTTLS") {
    return { ...diagnostic, status: "smtp_connection_error", hint: "Проверь соответствие SMTP_PORT и SMTP_SECURE и сертификат SMTP-сервера." };
  }
  if (command === "CONN" || ["ETIMEDOUT", "ESOCKET", "ECONNECTION", "EDNS", "ENOTFOUND", "EAI_AGAIN"].includes(code ?? "")) {
    return { ...diagnostic, status: "smtp_connection_error", hint: "Проверь DNS и исходящее TCP-подключение VPS к SMTP-серверу и порту." };
  }
  return { ...diagnostic, status: "send_error", hint: "Проверь адрес отправителя и ограничения почтового сервера." };
}
