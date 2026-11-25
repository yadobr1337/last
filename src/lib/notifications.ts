import { NotificationType, type Prisma, type User } from "@prisma/client";
import { setTimeout as delay } from "node:timers/promises";
import { db } from "@/lib/db";
import { withWorkLease } from "@/lib/work-lease";
import { sendTelegramMessage, sendTelegramPhoto } from "@/lib/telegram";
import { queuedTelegramText, telegramAnnouncement, type TelegramButton } from "@/lib/telegram-templates";

const notificationButtons: Record<NotificationType, TelegramButton> = {
  TOPUP: "balance",
  ADMIN_GRANT: "account",
  EXPIRING_SOON: "topUp",
  EXPIRED: "topUp",
  DELETION_WARNING: "topUp",
  DELETED: "topUp",
  BANNED: "account",
  UNBANNED: "account",
};

export async function notifyUserOnce(params: {
  user: Pick<User, "id" | "telegramId" | "email">;
  type: NotificationType;
  cycleKey: string;
  message: string;
}, tx: Prisma.TransactionClient = db) {
  return tx.notificationEvent.upsert({
    where: {
      userId_type_cycleKey: {
        userId: params.user.id,
        type: params.type,
        cycleKey: params.cycleKey,
      },
    },
    update: {},
    create: {
      userId: params.user.id,
      type: params.type,
      cycleKey: params.cycleKey,
      message: params.user.telegramId ? null : "Telegram ID is not linked.",
      deliveryText: params.user.telegramId ? params.message : null,
      nextAttemptAt: params.user.telegramId ? new Date() : null,
    },
  });
}

export async function processNotifications() {
  await withWorkLease("telegram-delivery", 120_000, async () => {
    const deadline = Date.now() + 40_000;
    const events = await db.notificationEvent.findMany({
      where: { success: false, nextAttemptAt: { lte: new Date() } },
      include: { user: { select: { telegramId: true } } },
      orderBy: { nextAttemptAt: "asc" },
      take: 40,
    });
    for (const event of events) {
      if (Date.now() >= deadline) break;
      if (!event.user.telegramId || !event.deliveryText || event.attempts >= 4) {
        await db.notificationEvent.update({
          where: { id: event.id },
          data: { nextAttemptAt: null, deliveryText: null, message: "Telegram delivery unavailable or attempts exhausted." },
        });
        continue;
      }
      const attempt = event.attempts + 1;
      const reserved = await db.notificationEvent.updateMany({
        where: { id: event.id, success: false, attempts: event.attempts, nextAttemptAt: { lte: new Date() } },
        data: { attempts: attempt, nextAttemptAt: new Date(Date.now() + 120_000) },
      });
      if (!reserved.count) continue;

      const result = await sendTelegramMessage(
        event.user.telegramId, queuedTelegramText(event.deliveryText), notificationButtons[event.type],
      );
      const status = "status" in result ? result.status : undefined;
      const retry = !result.ok && attempt < 4 && (status === undefined || status === 429 || status >= 500);
      await db.notificationEvent.updateMany({
        where: { id: event.id, attempts: attempt },
        data: {
          success: result.ok,
          message: result.ok ? "Delivered to Telegram." : result.error,
          nextAttemptAt: retry ? new Date(Date.now() + attempt * 120_000) : null,
          deliveryText: retry ? event.deliveryText : null,
        },
      });
      if (!result.ok && "status" in result && result.status === 429) break;
      await delay(80);
    }
  });
}

export async function broadcastTelegramMessage(params: {
  text: string;
  photo?: File | null;
  actor: string;
}) {
  return withWorkLease("telegram-broadcast", 60 * 60_000, async () => {
    await db.adminAuditEvent.create({
      data: { actor: params.actor, action: "TELEGRAM_BROADCAST", details: { photo: Boolean(params.photo) } },
    });
    return deliverTelegramBroadcast(params);
  });
}

async function deliverTelegramBroadcast(params: { text: string; photo?: File | null }) {
  const users = await db.user.findMany({
    where: {
      telegramId: {
        not: null,
      },
    },
    select: {
      telegramId: true,
    },
  });

  const parts = telegramAnnouncement(params.text, Boolean(params.photo));
  let delivered = 0;
  let failed = 0;
  const errors = new Map<string, number>();

  for (const user of users) {
    if (!user.telegramId) continue;

    const firstButton = parts.length === 1 ? "site" : undefined;
    let result = params.photo
      ? await sendTelegramPhoto(user.telegramId, parts[0], params.photo, firstButton)
      : await sendTelegramMessage(user.telegramId, parts[0], firstButton);
    for (let index = 1; result.ok && index < parts.length; index++) {
      await delay(1_000);
      const button = index === parts.length - 1 ? "site" : undefined;
      result = await sendTelegramMessage(user.telegramId, parts[index], button);
    }

    if (result.ok) {
      delivered += 1;
    } else {
      failed += 1;
      errors.set(result.error, (errors.get(result.error) ?? 0) + 1);
    }
    if (!result.ok && "status" in result && result.status === 429) {
      failed = users.length - delivered;
      break;
    }
    await delay(80);
  }

  return {
    recipients: users.length,
    delivered,
    failed,
    errors: Array.from(errors.entries())
      .slice(0, 3)
      .map(([message, count]) => ({ message, count })),
  };
}
