import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { publicEnv } from "@/lib/public-env";
import { issueTelegramLinkToken } from "@/lib/telegram-link";
import { takeRateLimit } from "@/lib/rate-limit";

export async function POST() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!await takeRateLimit("telegram-link", session.user.id, 5, 60_000)) {
    return NextResponse.json({ error: "Повторите позже." }, { status: 429 });
  }

  const botUsername = publicEnv.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  if (!botUsername) {
    return NextResponse.json(
      { error: "Telegram bot username is not configured." },
      { status: 503 },
    );
  }

  const token = await issueTelegramLinkToken(session.user.id);
  return NextResponse.json({
    url: `https://t.me/${botUsername}?start=link_${token}`,
  });
}
