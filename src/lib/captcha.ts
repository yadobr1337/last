import { isIP } from "node:net";
import { env } from "@/lib/env";

export function getCaptchaSiteKey() {
  return env.SMARTCAPTCHA_SERVER_KEY ? env.SMARTCAPTCHA_SITE_KEY : undefined;
}

type CaptchaResult = "valid" | "invalid" | "unavailable";

export async function verifyCaptchaToken(token: string | undefined, clientIp: string | null): Promise<CaptchaResult> {
  if (!env.SMARTCAPTCHA_SERVER_KEY || !getCaptchaSiteKey()) return "unavailable";
  if (!token) return "invalid";

  const body = new URLSearchParams({
    secret: env.SMARTCAPTCHA_SERVER_KEY,
    token,
  });
  if (clientIp && isIP(clientIp)) body.set("ip", clientIp);

  try {
    const response = await fetch("https://smartcaptcha.cloud.yandex.ru/validate", {
      method: "POST",
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return "unavailable";

    const data = (await response.json()) as { status?: unknown; host?: unknown } | null;
    if (data?.status === "failed") return "invalid";
    if (data?.status !== "ok" || typeof data.host !== "string" || !data.host) return "unavailable";

    const siteHost = env.NEXTAUTH_URL ? new URL(env.NEXTAUTH_URL).host.replace(/^www\./, "") : undefined;
    const verifiedHost = data.host.toLowerCase().replace(/^www\./, "");
    return !siteHost || verifiedHost === siteHost ? "valid" : "invalid";
  } catch {
    return "unavailable";
  }
}
