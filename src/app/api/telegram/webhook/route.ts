import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeTransaction } from "@/lib/db";
import { queueVpnSync } from "@/lib/billing";
import { env } from "@/lib/env";
import { sendTelegramMessage } from "@/lib/telegram";
import { consumeTelegramLinkToken } from "@/lib/telegram-link";

export const runtime = "nodejs";

const updateSchema = z.object({
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({
        id: z.number(),
        type: z.string(),
      }),
      from: z
        .object({
          id: z.number(),
          first_name: z.string(),
          username: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

function secretsMatch(received: string | null, expected: string) {
  if (!received) return false;

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

export async function POST(request: Request) {
  if (
    !env.TELEGRAM_WEBHOOK_SECRET ||
    !secretsMatch(
      request.headers.get("x-telegram-bot-api-secret-token"),
      env.TELEGRAM_WEBHOOK_SECRET,
    )
  ) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }

  const message = parsed.data.message;
  const text = message?.text?.trim() ?? "";
  const match = text.match(/^\/start(?:@\w+)?\s+link_([A-Za-z0-9_-]+)$/);

  if (!message || message.chat.type !== "private" || !message.from ||
      message.from.id !== message.chat.id || !match) {
    if (message?.chat.type === "private" && text.startsWith("/start")) {
      await sendTelegramMessage(
        String(message.chat.id),
        "<b>1VPN</b>\nОткройте личный кабинет на сайте и нажмите «Привязать через Telegram».",
      );
    }
    return NextResponse.json({ ok: true });
  }

  const link = await consumeTelegramLinkToken(match[1]);
  if (!link) {
    await sendTelegramMessage(
      String(message.chat.id),
      "<b>1VPN</b>\nСсылка привязки истекла или уже использована. Создайте новую в личном кабинете.",
    );
    return NextResponse.json({ ok: true });
  }

  const sender = message.from;
  try {
    await writeTransaction(async (tx) => {
      await tx.verificationToken.delete({
        where: { token: link.storedToken, expires: { gt: new Date() } },
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: link.userId, isBanned: false },
        select: { telegramId: true },
      });
      await tx.user.update({
        where: { id: link.userId },
        data: {
          telegramId: String(sender.id),
          telegramFirstName: sender.first_name,
          telegramUsername: sender.username ?? null,
          telegramPhotoUrl: user.telegramId === String(sender.id) ? undefined : null,
          telegramBotConfirmedAt: new Date(),
          ...queueVpnSync(),
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await sendTelegramMessage(
        String(message.chat.id),
        "<b>1VPN</b>\nЭтот Telegram уже привязан к другому аккаунту.",
      );
      return NextResponse.json({ ok: true });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      await sendTelegramMessage(
        String(message.chat.id),
        "<b>1VPN</b>\nСсылка привязки уже использована или аккаунт больше недоступен.",
      );
      return NextResponse.json({ ok: true });
    }
    throw error;
  }

  const dashboardUrl = env.NEXTAUTH_URL
    ? `\n\n<a href="${env.NEXTAUTH_URL}/dashboard/account">Вернуться в личный кабинет</a>`
    : "";
  await sendTelegramMessage(
    String(message.chat.id),
    `<b>1VPN</b>\nTelegram успешно привязан. Уведомления о балансе и подписке включены.${dashboardUrl}`,
  );

  return NextResponse.json({ ok: true });
}
