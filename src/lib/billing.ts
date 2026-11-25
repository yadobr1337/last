import {
  NotificationType,
  Prisma,
  Role,
  TransactionType,
  type Squad,
  type User,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db, writeTransaction } from "@/lib/db";
import { canUseDemoPayments, MAX_BALANCE_KOPEKS } from "@/lib/money";
import { notifyUserOnce } from "@/lib/notifications";
import { telegramTemplates } from "@/lib/telegram-templates";
import {
  buildRemoteUsername,
  deleteRemoteUser,
  disableRemoteUser,
  ensureRemoteSquad,
  findRemoteUserByUsername,
  provisionRemoteUser,
} from "@/lib/remnawave";
import { getSettings } from "@/lib/settings";
import { MS_IN_DAY, SUBSCRIPTION_DELETION_GRACE_HOURS } from "@/lib/site";
import { ensureUserSquad } from "@/lib/squads";
import { withWorkLease } from "@/lib/work-lease";

type ManagedUser = User & {
  squad: Squad | null;
};

const BILLING_INTERVAL_MS = 10 * 60_000;
const DAY = BigInt(MS_IN_DAY);
const MICROS = 1_000_000n;
const KOPECK_UNITS = DAY * MICROS;

function normalizeDeviceCount(deviceCount: number) {
  return Math.max(1, deviceCount);
}

function computeRemainingDays(
  balanceKopeks: number,
  pricePerDayKopeks: number,
  deviceCount: number,
) {
  if (pricePerDayKopeks <= 0) {
    return 0;
  }

  return balanceKopeks / (pricePerDayKopeks * normalizeDeviceCount(deviceCount));
}

function accruedUnits(user: Pick<User, "billingCarryMicros" | "billingRemainder">) {
  return user.billingCarryMicros * DAY + user.billingRemainder;
}

function millisecondsUntilDepletion(
  user: Pick<User, "balanceKopeks" | "billingCarryMicros" | "billingRemainder">,
  pricePerDayKopeks: number,
  deviceCount: number,
) {
  const unitsPerMs = BigInt(pricePerDayKopeks) * BigInt(deviceCount) * MICROS;
  const remaining = BigInt(user.balanceKopeks) * KOPECK_UNITS - accruedUnits(user);
  return remaining > 0n && unitsPerMs > 0n
    ? Number((remaining + unitsPerMs - 1n) / unitsPerMs)
    : 0;
}

function resolveHwidDeviceLimit(user: Pick<User, "hwidDeviceLimit">, defaultLimit: number) {
  return normalizeDeviceCount(user.hwidDeviceLimit ?? defaultLimit);
}

function computeSubscriptionExpireAt(
  user: Pick<User, "balanceKopeks" | "lastBillingAt" | "hwidDeviceLimit" | "billingCarryMicros" | "billingRemainder">,
  settings: { pricePerDayKopeks: number; defaultHwidDeviceLimit: number },
  now = new Date(),
) {
  const deviceCount = resolveHwidDeviceLimit(user, settings.defaultHwidDeviceLimit);
  const remainingMs = millisecondsUntilDepletion(user, settings.pricePerDayKopeks, deviceCount);
  const anchor = user.lastBillingAt ?? now;

  return new Date(anchor.getTime() + remainingMs);
}

async function fetchManagedUser(userId: string, tx: Prisma.TransactionClient = db) {
  return tx.user.findUnique({
    where: { id: userId },
    include: { squad: true },
  });
}

export async function settleUserBilling(
  userId: string,
  tx: Prisma.TransactionClient,
  now = new Date(),
  currentSettings?: Awaited<ReturnType<typeof getSettings>>,
) {
  const settings = currentSettings ?? await getSettings(tx);
  const existing = await fetchManagedUser(userId, tx);

  if (!existing) {
    throw new Error("User not found.");
  }

  const user = existing;

  if (user.balanceKopeks <= 0) {
    if (!user.billingStartedAt && user.billingCycle === 0) {
      return user;
    }

    if (user.vpnProvisionState === "DELETED") {
      return user;
    }

    if (!user.subscriptionEndedAt) {
      return tx.user.update({
        where: { id: user.id },
        data: {
          balanceKopeks: 0,
          subscriptionEndedAt: now,
          removalScheduledAt: new Date(
            now.getTime() + SUBSCRIPTION_DELETION_GRACE_HOURS * 3_600_000,
          ),
          vpnProvisionState: "DISABLED",
          ...queueVpnSync(now),
        },
        include: { squad: true },
      });
    }

    const removalScheduledAt = new Date(
      user.subscriptionEndedAt.getTime() + SUBSCRIPTION_DELETION_GRACE_HOURS * 3_600_000,
    );
    if (user.removalScheduledAt?.getTime() !== removalScheduledAt.getTime()) {
      return tx.user.update({
        where: { id: user.id },
        data: { removalScheduledAt },
        include: { squad: true },
      });
    }

    return user;
  }

  if (user.isBanned) {
    return user;
  }

  if (!user.lastBillingAt && !user.billingStartedAt) {
    return tx.user.update({
      where: { id: user.id },
      data: { billingStartedAt: now, lastBillingAt: now, ...queueVpnSync(now) },
      include: { squad: true },
    });
  }
  const billingAnchor = user.lastBillingAt ?? user.billingStartedAt ?? now;
  const elapsedMs = Math.max(0, now.getTime() - billingAnchor.getTime());
  const deviceCount = resolveHwidDeviceLimit(user, settings.defaultHwidDeviceLimit);

  if (elapsedMs === 0) {
    return user;
  }

  if (settings.pricePerDayKopeks <= 0) {
    throw new Error("Daily price must be positive.");
  }

  const charge = accruedUnits(user) +
    BigInt(elapsedMs) * BigInt(settings.pricePerDayKopeks) * BigInt(deviceCount) * MICROS;
  const debitKopeks = charge / KOPECK_UNITS;
  const carry = charge % KOPECK_UNITS;

  if (debitKopeks >= BigInt(user.balanceKopeks)) {
    const msUntilDepleted = millisecondsUntilDepletion(user, settings.pricePerDayKopeks, deviceCount);
    const endedAt = new Date(billingAnchor.getTime() + msUntilDepleted);

    return tx.user.update({
      where: { id: user.id },
      data: {
        balanceKopeks: 0,
        billingCarryMicros: 0,
        billingRemainder: 0,
        lastBillingAt: endedAt,
        subscriptionEndedAt: endedAt,
        removalScheduledAt: new Date(
          endedAt.getTime() + SUBSCRIPTION_DELETION_GRACE_HOURS * 3_600_000,
        ),
        vpnProvisionState: "DISABLED",
        ...queueVpnSync(now),
        transactions: {
          create: {
            type: TransactionType.BILLING_DEBIT,
            amountKopeks: -user.balanceKopeks,
            description: "Automatic daily billing",
          },
        },
      },
      include: { squad: true },
    });
  }

  return tx.user.update({
    where: { id: user.id },
    data: {
      balanceKopeks: { decrement: Number(debitKopeks) },
      billingCarryMicros: carry / DAY,
      billingRemainder: carry % DAY,
      lastBillingAt: now,
      transactions: debitKopeks === 0n ? undefined : {
        create: {
          type: TransactionType.BILLING_DEBIT,
          amountKopeks: -Number(debitKopeks),
          description: "Automatic daily billing",
        },
      },
    },
    include: { squad: true },
  });
}

export function queueVpnSync(at = new Date()) {
  return { vpnSyncAt: at, vpnSyncRevision: { increment: 1 } };
}

async function activateSubscription(params: {
  tx: Prisma.TransactionClient;
  user: ManagedUser;
  amountKopeks: number;
  type: TransactionType;
  description: string;
  markTrial?: boolean;
  actor?: string;
  now?: Date;
  ledgerId?: string;
}) {
  if (
    !Number.isInteger(params.amountKopeks) ||
    params.amountKopeks <= 0 ||
    params.amountKopeks > MAX_BALANCE_KOPEKS - params.user.balanceKopeks
  ) {
    throw new Error("Пополнение превышает допустимый диапазон баланса.");
  }

  const now = params.now ?? new Date();
  const isReactivation = params.user.balanceKopeks <= 0;

  return params.tx.user.update({
    where: { id: params.user.id },
    data: {
      balanceKopeks: {
        increment: params.amountKopeks,
      },
      billingCarryMicros: isReactivation ? 0 : params.user.billingCarryMicros,
      billingRemainder: isReactivation ? 0 : params.user.billingRemainder,
      billingStartedAt: isReactivation ? now : params.user.billingStartedAt ?? now,
      lastBillingAt: isReactivation ? now : params.user.lastBillingAt ?? now,
      billingCycle: isReactivation ? { increment: 1 } : undefined,
      subscriptionEndedAt: null,
      removalScheduledAt: null,
      trialClaimedAt: params.markTrial ? now : undefined,
      ...queueVpnSync(now),
      transactions: {
        create: {
          id: params.ledgerId,
          type: params.type,
          amountKopeks: params.amountKopeks,
          description: params.description,
          metadata: params.actor ? { actor: params.actor } : undefined,
        },
      },
    },
    include: { squad: true },
  });
}

export async function creditBalance(tx: Prisma.TransactionClient, params: {
  userId: string;
  amountKopeks: number;
  description: string;
  notificationKey: string;
}) {
  const now = new Date();
  const settled = await settleUserBilling(params.userId, tx, now);
  const user = await activateSubscription({
    tx,
    user: settled,
    amountKopeks: params.amountKopeks,
    type: TransactionType.TOPUP,
    description: params.description,
    now,
  });
  if (user.telegramId) {
    await tx.notificationEvent.create({
      data: {
        userId: user.id,
        type: NotificationType.TOPUP,
        cycleKey: params.notificationKey,
        nextAttemptAt: now,
        deliveryText: telegramTemplates.topUp(params.amountKopeks, user.balanceKopeks),
      },
    });
  }
  return user;
}

export async function topUpBalance(params: { userId: string; amountKopeks: number; description: string }) {
  if (!canUseDemoPayments()) throw new Error("Demo payments are disabled.");
  const notificationKey = `demo:${randomUUID()}`;
  return writeTransaction((tx) => creditBalance(tx, { ...params, notificationKey }));
}

export async function changeDeviceLimit(userId: string, hwidDeviceLimit: number | null, actor?: string) {
  if (hwidDeviceLimit !== null && (!Number.isInteger(hwidDeviceLimit) || hwidDeviceLimit < 1 || hwidDeviceLimit > 100)) {
    throw new Error("Допустимо от 1 до 100 устройств.");
  }
  await writeTransaction(async (tx) => {
    const now = new Date();
    await settleUserBilling(userId, tx, now);
    await tx.user.update({
      where: { id: userId },
      data: { hwidDeviceLimit, ...queueVpnSync(now) },
    });
    if (actor) {
      await tx.adminAuditEvent.create({
        data: { actor, target: userId, action: "DEVICE_LIMIT", details: { hwidDeviceLimit } },
      });
    }
  });
  await tryImmediateVpnSync(userId);
}

export async function changeBillingSettings(data: Prisma.SystemSettingsUpdateInput, actor: string) {
  await writeTransaction(async (tx) => {
    const now = new Date();
    const settings = await getSettings(tx);
    if (data.pricePerDayKopeks !== settings.pricePerDayKopeks ||
        data.defaultHwidDeviceLimit !== settings.defaultHwidDeviceLimit) {
      const affected = { balanceKopeks: { gt: 0 } };
      const users = await tx.user.findMany({ where: affected, select: { id: true } });
      for (const { id } of users) {
        await settleUserBilling(id, tx, now, settings);
      }
      await tx.user.updateMany({ where: affected, data: queueVpnSync(now) });
    }
    await tx.systemSettings.update({ where: { id: settings.id }, data });
    await tx.adminAuditEvent.create({
      data: {
        actor,
        action: "BILLING_SETTINGS",
        details: {
          pricePerDayKopeks: typeof data.pricePerDayKopeks === "number" ? data.pricePerDayKopeks : null,
          defaultHwidDeviceLimit: typeof data.defaultHwidDeviceLimit === "number" ? data.defaultHwidDeviceLimit : null,
        },
      },
    });
  });
}

export async function claimTrialDay(userId: string) {
  const user = await writeTransaction(
    async (tx) => {
      const settings = await getSettings(tx);
      const settled = await settleUserBilling(userId, tx);
      const trialAmount =
        settings.pricePerDayKopeks *
        settings.trialDays *
        resolveHwidDeviceLimit(settled, settings.defaultHwidDeviceLimit);

      if (settled.trialClaimedAt) {
        throw new Error("Trial has already been claimed.");
      }
      if (settled.isBanned || !settled.telegramBotConfirmedAt) {
        throw new Error("Сначала подтвердите привязку Telegram.");
      }

      return activateSubscription({
        tx,
        user: settled,
        amountKopeks: trialAmount,
        type: TransactionType.TRIAL,
        description: "One-time free trial",
        markTrial: true,
      });
    },
  );

  await tryImmediateVpnSync(user.id);
  return user;
}

export async function adjustBalanceByAdmin(params: {
  userId: string;
  amountKopeks: number;
  description: string;
  actor: string;
}) {
  if (params.amountKopeks === 0) {
    throw new Error("Adjustment amount must not be zero.");
  }

  const notificationKey = `admin:${randomUUID()}`;
  const user = await writeTransaction(
    async (tx) => {
      const settled = await settleUserBilling(params.userId, tx);
      await tx.adminAuditEvent.create({
        data: {
          actor: params.actor,
          action: "ADJUST_BALANCE",
          target: params.userId,
          details: { requestedKopeks: params.amountKopeks },
        },
      });

      if (params.amountKopeks > 0) {
        const credited = await activateSubscription({
          tx,
          user: settled,
          amountKopeks: params.amountKopeks,
          type: TransactionType.ADMIN_ADJUSTMENT,
          description: params.description,
          actor: params.actor,
        });
        await notifyUserOnce({
          user: credited,
          type: NotificationType.TOPUP,
          cycleKey: notificationKey,
          message: telegramTemplates.topUp(params.amountKopeks, credited.balanceKopeks, true),
        }, tx);
        return credited;
      }

      const nextBalance = Math.max(0, settled.balanceKopeks + params.amountKopeks);
      const actualAdjustment = nextBalance - settled.balanceKopeks;

      if (actualAdjustment === 0) {
        throw new Error("Баланс пользователя уже равен нулю.");
      }

      return tx.user.update({
        where: { id: settled.id },
        data: {
          balanceKopeks: nextBalance,
          billingCarryMicros: nextBalance === 0 ? 0 : settled.billingCarryMicros,
          billingRemainder: nextBalance === 0 ? 0 : settled.billingRemainder,
          ...queueVpnSync(),
          lastBillingAt: new Date(),
          subscriptionEndedAt: nextBalance === 0 ? new Date() : null,
          removalScheduledAt:
            nextBalance === 0
              ? new Date(Date.now() + SUBSCRIPTION_DELETION_GRACE_HOURS * 3_600_000)
              : null,
          transactions: {
            create: {
              type: TransactionType.ADMIN_ADJUSTMENT,
              amountKopeks: actualAdjustment,
              description: params.description,
              metadata: { actor: params.actor },
            },
          },
        },
        include: { squad: true },
      });
    },
  );

  await tryImmediateVpnSync(user.id);
  return user;
}

export async function grantDaysToAllUsers(params: {
  days: number;
  description: string;
  actor: string;
  requestId?: string;
}) {
  if (!Number.isInteger(params.days) || params.days < 1 || params.days > 3650) {
    throw new Error("Количество дней должно быть от 1 до 3650.");
  }

  const settings = await getSettings();
  if (settings.pricePerDayKopeks <= 0) {
    throw new Error("Сначала укажите положительную стоимость дня в настройках.");
  }

  const operationId = `grant-days:${params.actor}:${params.requestId ?? randomUUID()}`;
  const operation = await writeTransaction((tx) => tx.adminAuditEvent.upsert({
    where: { id: operationId },
    update: {},
    create: { id: operationId, actor: params.actor, action: "GRANT_DAYS", details: { days: params.days, description: params.description } },
  }));
  const details = operation.details;
  if (!details || typeof details !== "object" || Array.isArray(details) ||
      details.days !== params.days || details.description !== params.description) {
    throw new Error("Для другого начисления откройте форму заново.");
  }
  const users = await db.user.findMany({
    where: { role: Role.USER, createdAt: { lte: operation.createdAt } },
    select: { id: true },
  });
  const cycleKey = `admin-grant:${operation.id}`;
  let granted = 0;
  let failed = 0;
  let notified = 0;

  for (const item of users) {
    try {
      const queued = await writeTransaction(
        async (tx) => {
          const ledgerId = `${operation.id}:${item.id}`;
          if (await tx.balanceTransaction.findUnique({ where: { id: ledgerId }, select: { id: true } })) {
            return false;
          }
          const currentSettings = await getSettings(tx);
          const settled = await settleUserBilling(item.id, tx, new Date(), currentSettings);
          const amountKopeks = currentSettings.pricePerDayKopeks * params.days *
            resolveHwidDeviceLimit(settled, currentSettings.defaultHwidDeviceLimit);

          const user = await activateSubscription({
            tx,
            user: settled,
            amountKopeks,
            type: TransactionType.ADMIN_ADJUSTMENT,
            description: params.description,
            actor: params.actor,
            ledgerId,
          });
          if (!user.telegramId) return false;
          await notifyUserOnce({
            user,
            type: NotificationType.ADMIN_GRANT,
            cycleKey,
            message: telegramTemplates.gift(params.days, params.description),
          }, tx);
          return true;
        },
      );

      granted += 1;
      if (queued) notified += 1;
    } catch {
      failed += 1;
      console.error("[admin-grant] user transaction failed", { operationId, userId: item.id });
    }
  }

  return {
    total: users.length,
    granted,
    failed,
    notified,
  };
}

export async function setBanState(userId: string, isBanned: boolean, actor: string) {
  const user = await writeTransaction(
    async (tx) => {
      const settled = await settleUserBilling(userId, tx);
      const now = new Date();

      if (settled.isBanned === isBanned) return null;
      await tx.adminAuditEvent.create({
        data: { actor, target: userId, action: isBanned ? "BAN_USER" : "UNBAN_USER" },
      });
      return tx.user.update({
        where: { id: settled.id },
        data: {
          isBanned,
          bannedAt: isBanned ? now : null,
          ...queueVpnSync(now),
          lastBillingAt:
            !isBanned && settled.balanceKopeks > 0 ? now : settled.lastBillingAt ?? now,
        },
        include: { squad: true },
      });
    },
  );

  if (!user) return null;
  await tryImmediateVpnSync(user.id);

  await notifyUserOnce({
    user,
    type: isBanned ? NotificationType.BANNED : NotificationType.UNBANNED,
    cycleKey: `${user.billingCycle}:${isBanned ? "banned" : "unbanned"}:${user.updatedAt.toISOString()}`,
    message: telegramTemplates.ban(isBanned),
  }).catch(() => console.error("[billing] ban notification queue failed"));

  return user;
}

async function tryImmediateVpnSync(userId: string) {
  await syncUserLifecycle(userId).catch(() => {
    console.error("[lifecycle] immediate synchronization failed");
  });
}

export async function syncUserLifecycle(userId: string, force = true) {
  return withWorkLease(`vpn-user:${userId}`, 120_000, async () => {
    const snapshot = await writeTransaction(async (tx) => {
      const alreadyExists = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!alreadyExists) return null;

      const settings = await getSettings(tx);
      const now = new Date();
      const managed = await settleUserBilling(userId, tx, now, settings);
      if (!force && (!managed.vpnSyncAt || managed.vpnSyncAt > now)) return null;
      if (managed.balanceKopeks > 0 && !managed.isBanned && !managed.squad) {
        managed.squad = await ensureUserSquad(managed.id, tx);
      }
      if (managed.balanceKopeks > 0 && !managed.isBanned && !managed.remnawaveUsername) {
        managed.remnawaveUsername = buildRemoteUsername(managed);
        await tx.user.update({
          where: { id: managed.id },
          data: { remnawaveUsername: managed.remnawaveUsername },
        });
      }
      if (force && !managed.vpnSyncAt) {
        await tx.user.update({
          where: { id: managed.id },
          data: { vpnSyncAt: now },
        });
      }
      return { managed, settings };
    });
    if (!snapshot) return null;
    return reconcileUserVpn(snapshot.managed, snapshot.settings);
  });
}

async function reconcileUserVpn(managed: ManagedUser, settings: Awaited<ReturnType<typeof getSettings>>) {
  const now = new Date();
  async function update(data: Prisma.UserUncheckedUpdateManyInput, next: Date | null = null) {
    return db.user.updateMany({
      where: { id: managed.id, vpnSyncRevision: managed.vpnSyncRevision },
      data: { ...data, vpnSyncAt: next },
    });
  }

  try {
    if (!managed.isBanned && managed.balanceKopeks <= 0 && managed.vpnProvisionState === "DELETED") {
      return update({});
    }
    let remoteUuid = managed.remnawaveUserUuid;
    if (!remoteUuid && managed.remnawaveUsername && (managed.isBanned || managed.subscriptionEndedAt)) {
      remoteUuid = (await findRemoteUserByUsername(managed.remnawaveUsername, managed.email))?.uuid ?? null;
    }
    if (managed.isBanned) {
      await disableRemoteUser(remoteUuid);
      return update({
        remnawaveUserUuid: remoteUuid,
        vpnProvisionState: remoteUuid ? "DISABLED" : "PENDING",
        vpnStatusMessage: "Paused by admin ban",
      });
    }

    if (managed.balanceKopeks > 0) {
      const expireAt = computeSubscriptionExpireAt(managed, settings, now);
      const remainingMs = expireAt.getTime() - now.getTime();

      if (remainingMs <= MS_IN_DAY) {
        await notifyUserOnce({
          user: managed,
          type: NotificationType.EXPIRING_SOON,
          cycleKey: `${managed.billingCycle}:one-day`,
          message: telegramTemplates.lowBalance(managed.balanceKopeks, remainingMs),
        });
      }

      let squadRemoteUuid = managed.squad?.remnawaveInternalSquadUuid ?? null;

      if (managed.squad && !squadRemoteUuid) {
        const squad = managed.squad;
        squadRemoteUuid = await withWorkLease(`vpn-squad:${squad.id}`, 60_000, async () => {
          const current = await db.squad.findUnique({ where: { id: squad.id } });
          if (!current) return null;
          if (current.remnawaveInternalSquadUuid) return current.remnawaveInternalSquadUuid;
          const uuid = await ensureRemoteSquad(current);
          if (uuid) {
            await db.squad.updateMany({
              where: { id: squad.id, remnawaveInternalSquadUuid: null },
              data: { remnawaveInternalSquadUuid: uuid },
            });
          }
          return uuid;
        }) ?? null;
      }

      if (!squadRemoteUuid) {
        return update({
            vpnProvisionState: "PENDING",
            vpnStatusMessage: managed.squad
              ? "Укажите UUID сквада Remnawave в админке или заполните REMNAWAVE_DEFAULT_INBOUND_UUIDS для автосоздания"
              : "Ожидает назначения в свободный сквад",
      }, new Date(Date.now() + BILLING_INTERVAL_MS));
      }

      const current = await db.user.findUnique({
        where: { id: managed.id, vpnSyncRevision: managed.vpnSyncRevision },
        select: { id: true },
      });
      if (!current) return;

      const remoteUser = await provisionRemoteUser({
        user: managed,
        squadRemoteUuid,
        hwidDeviceLimit: resolveHwidDeviceLimit(managed, settings.defaultHwidDeviceLimit),
        expireAt,
      });

      const next = new Date(now.getTime() + Math.max(1_000, Math.min(
        MS_IN_DAY,
        remainingMs > MS_IN_DAY ? remainingMs - MS_IN_DAY : remainingMs,
      )));
      if (!remoteUser) {
        return update({
          vpnStatusMessage: "Running locally. Remnawave integration is not configured.",
        }, new Date(Date.now() + BILLING_INTERVAL_MS));
      }
      const subscriptionUrl = managed.remnawaveUserUuid === remoteUser.uuid &&
        managed.remnawaveShortUuid === remoteUser.shortUuid && managed.subscriptionUrl
        ? managed.subscriptionUrl
        : remoteUser.subscriptionUrl;
      if (new URL(subscriptionUrl).protocol !== "https:") {
        throw new Error("Remnawave subscription URL must use HTTPS.");
      }
      return update({
        remnawaveUserUuid: remoteUser.uuid,
        remnawaveShortUuid: remoteUser.shortUuid,
        subscriptionUrl,
        vpnProvisionState: "ACTIVE",
        vpnStatusMessage: "Provisioned and active",
      }, next);
    }

    if (managed.subscriptionEndedAt) {
      await notifyUserOnce({
        user: managed,
        type: NotificationType.EXPIRED,
        cycleKey: `${managed.billingCycle}:expired`,
        message: telegramTemplates.expired(SUBSCRIPTION_DELETION_GRACE_HOURS),
      });
      await disableRemoteUser(remoteUuid);
    }

    if (managed.removalScheduledAt && managed.removalScheduledAt <= new Date()) {
      const current = await db.user.findUnique({
        where: { id: managed.id, vpnSyncRevision: managed.vpnSyncRevision },
        select: { id: true },
      });
      if (!current) return;
      await deleteRemoteUser(remoteUuid);
      const deleted = await update({
          remnawaveUserUuid: null,
          remnawaveShortUuid: null,
          subscriptionUrl: null,
          squadId: null,
          removalScheduledAt: null,
          vpnProvisionState: "DELETED",
          vpnStatusMessage: "Subscription link deleted after grace period",
      });
      if (!deleted.count) return;

      await notifyUserOnce({
        user: managed,
        type: NotificationType.DELETED,
        cycleKey: `${managed.billingCycle}:deleted`,
        message: telegramTemplates.deleted(),
      });

      return;
    }

    return update({
        remnawaveUserUuid: remoteUuid,
        vpnProvisionState: remoteUuid ? "DISABLED" : "PENDING",
        vpnStatusMessage: managed.subscriptionEndedAt
          ? "Waiting for balance top-up"
          : "Awaiting initial funding",
    }, managed.removalScheduledAt);
  } catch {
    return update({
        vpnProvisionState: "ERROR",
        vpnStatusMessage: "Ошибка синхронизации Remnawave. Запланирована повторная попытка.",
    }, new Date(Date.now() + BILLING_INTERVAL_MS));
  }
}

async function executeLifecycleSweep() {
  const now = new Date();
  const billingCutoff = new Date(now.getTime() - BILLING_INTERVAL_MS);
  const deadline = now.getTime() + 5 * 60_000;
  let cursor: string | undefined;
  do {
    const users: { id: string }[] = await db.user.findMany({
      where: {
        id: cursor ? { gt: cursor } : undefined,
        OR: [
          { vpnSyncAt: { lte: now } },
          { isBanned: false, balanceKopeks: { gt: 0 }, OR: [
            { lastBillingAt: { lte: billingCutoff } },
            { lastBillingAt: null },
          ] },
        ],
      },
      orderBy: { id: "asc" },
      select: { id: true },
      take: 40,
    });
    if (!users.length) break;
    for (let index = 0; index < users.length && Date.now() < deadline; index += 4) {
      const batch = users.slice(index, index + 4);
      const results = await Promise.allSettled(batch.map(({ id }) => syncUserLifecycle(id, false)));
      for (const result of results) {
        if (result.status === "rejected") console.error("[lifecycle] user reconciliation failed");
      }
    }
    cursor = users.at(-1)?.id;
  } while (cursor && Date.now() < deadline);
}

export async function runLifecycleSweep() {
  await withWorkLease("lifecycle", 8 * 60_000, executeLifecycleSweep);
}

export async function getUserOverview(userId: string) {
  const settings = await getSettings();
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { squad: true },
  });

  if (!user) {
    return null;
  }

  return {
    user,
    settings,
    remainingDays: computeRemainingDays(
      user.balanceKopeks,
      settings.pricePerDayKopeks,
      resolveHwidDeviceLimit(user, settings.defaultHwidDeviceLimit),
    ),
    effectiveHwidDeviceLimit: resolveHwidDeviceLimit(user, settings.defaultHwidDeviceLimit),
  };
}
