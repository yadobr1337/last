import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeTransaction } from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { sendTelegramMessage, verifyTelegramAuth } from "@/lib/telegram";
import { takeRateLimit } from "@/lib/rate-limit";
import { queueVpnSync } from "@/lib/billing";

const telegramPayload = z.object({
  id: z.union([z.string(), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  first_name: z.string(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.union([z.string(), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  hash: z.string(),
});

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = telegramPayload.safeParse(await request.json().catch(() => null));
  if (!payload.success || !request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Неверные данные Telegram." }, { status: 400 });
  }
  const verification = await verifyTelegramAuth(payload.data);

  if (!verification.ok) {
    return NextResponse.json({ error: verification.error }, { status: 400 });
  }

  if (!await takeRateLimit("telegram-widget-proof", payload.data.hash, 1, 6 * 60_000)) {
    return NextResponse.json({ error: "Подтверждение Telegram уже использовано." }, { status: 409 });
  }
  try {
    await writeTransaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: session.user.id, isBanned: false } });
      await tx.user.update({
        where: { id: user.id },
        data: {
          telegramId: verification.data.id,
          telegramFirstName: verification.data.firstName,
          telegramUsername: verification.data.username,
          telegramPhotoUrl: verification.data.photoUrl,
          telegramBotConfirmedAt: user.telegramId === verification.data.id ? user.telegramBotConfirmedAt : null,
          ...queueVpnSync(),
        },
      });
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    if (error.code === "P2025") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    if (error.code !== "P2002") throw error;
    return NextResponse.json(
      { error: "Этот Telegram уже привязан к другому аккаунту." },
      { status: 409 },
    );
  }

  await sendTelegramMessage(
    verification.data.id,
    "<b>1VPN</b>\nTelegram привязан. Уведомления о балансе и подписке включены.",
  );

  return NextResponse.json({ ok: true });
}
