"use server";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/passwords";
import { requireAdmin, requireUser } from "@/lib/auth";
import {
  adjustBalanceByAdmin,
  changeBillingSettings,
  changeDeviceLimit,
  claimTrialDay,
  grantDaysToAllUsers,
  runLifecycleSweep,
  setBanState,
  syncUserLifecycle,
  topUpBalance,
} from "@/lib/billing";
import {
  buildEmailVerificationIdentifier,
  buildPasswordChangeIdentifier,
  consumeEmailCode,
  issueEmailCode,
} from "@/lib/email-codes";
import { broadcastTelegramMessage } from "@/lib/notifications";
import { canUseDemoPayments, parseRubleAmount } from "@/lib/money";
import { takeRateLimit } from "@/lib/rate-limit";
import {
  checkRemnawaveConnection,
  deleteRemoteUserDevice,
  getRemoteInternalSquad,
  type RemnawaveConnectionStatus,
} from "@/lib/remnawave";
import { createSquad, deleteSquad, updateSquad } from "@/lib/squads";
import { resolveUserIdentifier } from "@/lib/user-identity";
import { SUBSCRIPTION_DELETION_GRACE_HOURS } from "@/lib/site";
import { smtpFailure } from "@/lib/smtp-transport";
import { TELEGRAM_ANNOUNCEMENT_MAX_LENGTH } from "@/lib/telegram-templates";
import { runProvisioningSweep } from "@/lib/provisioning";
import { getProvisioningConfig } from "@/lib/provisioning-capacity";
import {
  createYooKassaPayment,
  type YooKassaPaymentMethod,
} from "@/lib/yookassa";

function parseKopeks(value: FormDataEntryValue | null) {
  return parseRubleAmount(String(value ?? ""));
}

function parseOptionalInteger(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Invalid integer value.");
  }

  return parsed;
}

function parseRequiredPositiveInteger(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) {
    throw new Error("Invalid integer value.");
  }
  return parsed;
}

function parseRequiredString(value: FormDataEntryValue | null) {
  const parsed = String(value ?? "").trim();
  if (!parsed) {
    throw new Error("Value is required.");
  }
  return parsed;
}

function parseOptionalString(value: FormDataEntryValue | null) {
  const parsed = String(value ?? "").trim();
  return parsed || null;
}

function redirectByMailError(error: unknown, field: "emailStatus" | "passwordStatus" = "emailStatus") {
  redirect(`/dashboard/account?${field}=${smtpFailure(error).status}`);
}

export async function topUpBalanceAction(formData: FormData) {
  const session = await requireUser();

  if (!canUseDemoPayments()) {
    throw new Error("Automatic top-up is disabled until a payment provider is connected.");
  }

  await topUpBalance({
    userId: session.user.id,
    amountKopeks: parseKopeks(formData.get("amount")),
    description: "Instant checkout top-up",
  });

  revalidatePath("/dashboard");
  revalidatePath("/admin");
}

export async function createYooKassaPaymentAction(formData: FormData) {
  const session = await requireUser();
  const amountKopeks = parseKopeks(formData.get("amount"));
  const method = String(formData.get("method") ?? "bank_card");

  if (method !== "bank_card" && method !== "sbp") {
    throw new Error("Unsupported payment method.");
  }
  if (!await takeRateLimit("payment-start", session.user.id, 15, 10 * 60_000)) {
    throw new Error("Слишком много попыток оплаты. Повторите позже.");
  }

  const confirmationUrl = await createYooKassaPayment({
    userId: session.user.id,
    amountKopeks,
    method: method as YooKassaPaymentMethod,
  });

  redirect(confirmationUrl);
}

export async function claimTrialAction() {
  const session = await requireUser();

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { telegramBotConfirmedAt: true },
  });

  if (!user?.telegramBotConfirmedAt) {
    throw new Error("Сначала подтвердите Telegram, запустив бота.");
  }

  await claimTrialDay(session.user.id);
  revalidatePath("/dashboard");
  revalidatePath("/admin");
}

export async function updateSettingsAction(formData: FormData) {
  const { user } = await requireAdmin();
  const pricePerDayKopeks = parseKopeks(formData.get("pricePerDay"));
  if (pricePerDayKopeks <= 0) throw new Error("Укажите положительную стоимость дня.");
  const defaultHwidDeviceLimit = parseRequiredPositiveInteger(formData.get("defaultHwidDeviceLimit"));
  const trialDays = parseRequiredPositiveInteger(formData.get("trialDays"));
  if (defaultHwidDeviceLimit > 100 || trialDays > 3650 ||
      pricePerDayKopeks * defaultHwidDeviceLimit * trialDays > 2_147_483_647) {
    throw new Error("Цена, пробный период или лимит устройств выходят за допустимый диапазон.");
  }
  const supportTelegramUrl = parseOptionalString(formData.get("supportTelegramUrl"));
  if (supportTelegramUrl) {
    const url = new URL(supportTelegramUrl);
    if (url.protocol !== "https:" || url.hostname !== "t.me" || url.username || url.password) {
      throw new Error("Укажите ссылку поддержки на https://t.me/.");
    }
  }

  await changeBillingSettings({
      pricePerDayKopeks,
      trialDays,
      deletionGraceHours: SUBSCRIPTION_DELETION_GRACE_HOURS,
      defaultHwidDeviceLimit,
      captchaEnabled: String(formData.get("captchaEnabled")) === "on",
      supportTelegramUrl,
      heroAnnouncement: String(formData.get("heroAnnouncement") ?? "") || null,
  }, user.id);

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

export type SquadActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type SiteRestartActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type AdminBalanceActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type AdminOperationActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const initialSquadActionState: SquadActionState = {
  status: "idle",
  message: "",
};

function getActionErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 400) : "Неизвестная ошибка.";
}

export async function grantDaysToAllUsersAction(
  _previousState: AdminOperationActionState,
  formData: FormData,
): Promise<AdminOperationActionState> {
  const { user } = await requireAdmin();
  void _previousState;

  try {
    const days = parseRequiredPositiveInteger(formData.get("days"));
    const description =
      parseOptionalString(formData.get("description")) ??
      `Подарок от 1VPN: ${days} дополнительных дней подписки.`;
    if (description.length > 300) throw new Error("Описание должно содержать до 300 символов.");
    const requestId = z.uuid().parse(formData.get("requestId"));
    const result = await grantDaysToAllUsers({ days, description, actor: user.id, requestId });

    revalidatePath("/admin");
    revalidatePath("/dashboard");
    return {
      status: result.failed ? "error" : "success",
      message: `Обработано: ${result.granted} из ${result.total}. Начислено за ${days} дн. с учётом устройств. Ошибок баланса: ${result.failed}.`,
    };
  } catch (error) {
    return { status: "error", message: getActionErrorMessage(error) };
  }
}

export async function updateMaintenanceAction(
  _previousState: AdminOperationActionState,
  formData: FormData,
): Promise<AdminOperationActionState> {
  await requireAdmin();
  void _previousState;

  try {
    const enabled = String(formData.get("enabled")) === "on";
    const message = parseOptionalString(formData.get("message"));

    await db.systemSettings.update({
      where: { id: "default" },
      data: {
        maintenanceEnabled: enabled,
        maintenanceMessage: message,
      },
    });

    revalidatePath("/", "layout");
    return {
      status: "success",
      message: enabled
        ? "Технический режим включён. Администраторы сохраняют доступ."
        : "Технический режим выключен. Сайт снова доступен пользователям.",
    };
  } catch (error) {
    return { status: "error", message: getActionErrorMessage(error) };
  }
}

export async function broadcastTelegramAction(
  _previousState: AdminOperationActionState,
  formData: FormData,
): Promise<AdminOperationActionState> {
  const { user } = await requireAdmin();
  void _previousState;

  try {
    const text = formData.get("text");
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("Введите текст рассылки.");
    }
    if (text.length > TELEGRAM_ANNOUNCEMENT_MAX_LENGTH) {
      throw new Error(`Текст рассылки должен быть не длиннее ${TELEGRAM_ANNOUNCEMENT_MAX_LENGTH} символов.`);
    }

    const photoEntry = formData.get("photo");
    const photo =
      photoEntry instanceof File && photoEntry.size > 0 ? photoEntry : null;

    if (photo && (!photo.type.startsWith("image/") || photo.size > 7 * 1024 * 1024)) {
      throw new Error("Загрузите изображение размером не более 7 МБ.");
    }

    const result = await broadcastTelegramMessage({ text, photo, actor: user.id });
    if (!result) return { status: "error", message: "Рассылка уже выполняется." };
    const errorSummary = result.errors.length
      ? ` Причина: ${result.errors
          .map((item) => `${item.count}× ${item.message.slice(0, 120)}`)
          .join("; ")}`
      : "";

    return {
      status: result.failed ? "error" : "success",
      message:
        result.recipients === 0
          ? "Нет получателей: ни у одного пользователя пока нет Telegram ID."
          : `Доставлено: ${result.delivered} из ${result.recipients}. Ошибок: ${result.failed}.${errorSummary}`,
    };
  } catch (error) {
    return { status: "error", message: getActionErrorMessage(error) };
  }
}

export async function restartSiteAction(
  _previousState: SiteRestartActionState,
): Promise<SiteRestartActionState> {
  const { user } = await requireAdmin();
  void _previousState;
  await db.adminAuditEvent.create({ data: { actor: user.id, action: "RESTART_SITE" } });

  const restartRequestPath = "/var/www/site1vpn/runtime/restart.request";
  let requestFileError: string | null = null;

  try {
    await mkdir(dirname(restartRequestPath), { recursive: true });
    await writeFile(restartRequestPath, new Date().toISOString(), "utf8");
  } catch (error) {
    requestFileError = getActionErrorMessage(error);
  }

  if (process.env.NODE_ENV === "production") {
    setTimeout(() => {
      process.kill(process.pid, "SIGTERM");
    }, 1_500);
  }

  return {
    status: "success",
    message: requestFileError
      ? `Перезапуск процесса запланирован. Резервный systemd-запрос не создан: ${requestFileError}`
      : "Запрос отправлен. Сайт перезапускается и снова откроется через несколько секунд.",
  };
}

export async function createSquadAction(
  _previousState: SquadActionState = initialSquadActionState,
  formData: FormData,
): Promise<SquadActionState> {
  const { user } = await requireAdmin();
  void _previousState;

  try {
    const remnawaveInternalSquadUuid = z.uuid().parse(
      formData.get("remnawaveInternalSquadUuid"),
    );
    await getRemoteInternalSquad(remnawaveInternalSquadUuid);
    await createSquad({
      actor: user.id,
      name: String(formData.get("name") ?? ""),
      memberLimit: parseRequiredPositiveInteger(formData.get("memberLimit")),
      remnawaveInternalSquadUuid,
    });
    await runLifecycleSweep();
    revalidatePath("/admin");
    revalidatePath("/dashboard");
    return { status: "success", message: "Сквад добавлен, синхронизация запущена." };
  } catch (error) {
    return { status: "error", message: getActionErrorMessage(error) };
  }
}

export async function updateSquadLimitAction(
  _previousState: SquadActionState = initialSquadActionState,
  formData: FormData,
): Promise<SquadActionState> {
  const { user } = await requireAdmin();
  void _previousState;

  try {
    const remnawaveInternalSquadUuid = z.uuid().parse(
      formData.get("remnawaveInternalSquadUuid"),
    );
    await getRemoteInternalSquad(remnawaveInternalSquadUuid);
    await updateSquad({
      actor: user.id,
      squadId: String(formData.get("squadId")),
      name: String(formData.get("name") ?? ""),
      memberLimit: parseRequiredPositiveInteger(formData.get("memberLimit")),
      isActive: String(formData.get("isActive")) === "on",
      remnawaveInternalSquadUuid,
    });
    revalidatePath("/admin");
    revalidatePath("/dashboard");
    return { status: "success", message: "Сквад обновлён, синхронизация запланирована." };
  } catch (error) {
    return { status: "error", message: getActionErrorMessage(error) };
  }
}

export async function deleteSquadAction(
  _previousState: SquadActionState = initialSquadActionState,
  formData: FormData,
): Promise<SquadActionState> {
  const { user } = await requireAdmin();
  void _previousState;

  try {
    await deleteSquad(parseRequiredString(formData.get("squadId")), user.id);
    revalidatePath("/admin");
    revalidatePath("/dashboard");
    return {
      status: "success",
      message: "Сквад удалён. Перераспределение пользователей запланировано.",
    };
  } catch (error) {
    return { status: "error", message: getActionErrorMessage(error) };
  }
}

export async function toggleBanAction(formData: FormData) {
  const { user } = await requireAdmin();
  await setBanState(
    await resolveUserIdentifier(String(formData.get("userId") ?? "")),
    String(formData.get("ban")) === "true",
    user.id,
  );
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

export async function adjustUserBalanceAction(
  _previousState: AdminBalanceActionState,
  formData: FormData,
): Promise<AdminBalanceActionState> {
  const { user } = await requireAdmin();
  void _previousState;

  try {
    const operation = String(formData.get("operation") ?? "");
    const amountKopeks = Math.abs(parseKopeks(formData.get("amount")));

    if (amountKopeks <= 0 || !["credit", "debit"].includes(operation)) {
      return { status: "error", message: "Укажите положительную сумму и выберите операцию." };
    }

    const isCredit = operation === "credit";
    await adjustBalanceByAdmin({
      actor: user.id,
      userId: await resolveUserIdentifier(String(formData.get("userId") ?? "")),
      amountKopeks: isCredit ? amountKopeks : -amountKopeks,
      description:
        String(formData.get("description") ?? "").trim() ||
        (isCredit ? "Пополнение администратором" : "Списание администратором"),
    });
    revalidatePath("/admin");
    revalidatePath("/dashboard");

    return {
      status: "success",
      message: isCredit ? "Сумма добавлена к балансу." : "Сумма списана с баланса.",
    };
  } catch (error) {
    return { status: "error", message: getActionErrorMessage(error) };
  }
}

export async function updateUserHwidAction(formData: FormData) {
  const { user } = await requireAdmin();
  const userId = await resolveUserIdentifier(String(formData.get("userId") ?? ""));

  await changeDeviceLimit(userId, parseOptionalInteger(formData.get("hwidDeviceLimit")), user.id);
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

export async function updateOwnHwidAction(formData: FormData) {
  const session = await requireUser();

  await changeDeviceLimit(session.user.id, parseRequiredPositiveInteger(formData.get("hwidDeviceLimit")));
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

export async function updateOwnEmailAction(formData: FormData) {
  const session = await requireUser();
  const email = parseRequiredString(formData.get("email")).toLowerCase();
  if (!z.email().max(254).safeParse(email).success || email.endsWith("@1vpn.local")) {
    redirect("/dashboard/account?emailStatus=invalid_email");
  }

  const existing = await db.user.findFirst({
    where: {
      email,
      NOT: {
        id: session.user.id,
      },
    },
    select: { id: true },
  });

  if (existing) {
    redirect("/dashboard/account?emailStatus=email_exists");
  }

  await db.user.update({
    where: { id: session.user.id },
    data: {
      pendingEmail: email,
    },
  });

  try {
    await issueEmailCode({
      identifier: buildEmailVerificationIdentifier(session.user.id, email),
      email,
      subject: "1VPN: подтверждение email",
      title: "Подтвердите email",
      description:
        "Введите код на странице настроек аккаунта, чтобы привязать или изменить email для входа и уведомлений.",
    });
  } catch (error) {
    redirectByMailError(error);
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/account");
  redirect("/dashboard/account?emailStatus=sent");
}

export async function verifyOwnEmailAction(formData: FormData) {
  const session = await requireUser();
  const code = parseRequiredString(formData.get("code"));

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      pendingEmail: true,
      email: true,
      emailVerified: true,
      isEmailPlaceholder: true,
    },
  });

  const target = user?.pendingEmail ?? (user && !user.isEmailPlaceholder && !user.emailVerified ? user.email : null);
  if (!user || !target) {
    redirect("/dashboard/account?emailStatus=no_pending_email");
  }

  const valid = await consumeEmailCode(
    buildEmailVerificationIdentifier(user.id, target),
    code,
    (tx) => tx.user.update({
      where: { id: user.id, email: user.email, pendingEmail: user.pendingEmail, isBanned: false },
      data: { email: target, pendingEmail: null, isEmailPlaceholder: false, emailVerified: new Date() },
    }),
  );

  if (!valid) {
    redirect("/dashboard/account?emailStatus=invalid_code");
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/account");
  redirect("/dashboard/account?emailStatus=verified");
}

export async function resendOwnEmailVerificationAction() {
  const session = await requireUser();
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      pendingEmail: true,
      isEmailPlaceholder: true,
      emailVerified: true,
    },
  });

  if (!user) {
    redirect("/dashboard/account?emailStatus=user_not_found");
  }

  const targetEmail = user.pendingEmail ?? (!user.isEmailPlaceholder ? user.email : null);
  if (!targetEmail) {
    redirect("/dashboard/account?emailStatus=no_pending_email");
  }

  try {
    await issueEmailCode({
      identifier: buildEmailVerificationIdentifier(user.id, targetEmail),
      email: targetEmail,
      subject: "1VPN: код подтверждения email",
      title: "Подтверждение email",
      description:
        user.pendingEmail || !user.emailVerified
          ? "Подтвердите email кодом, чтобы использовать вход по почте и получать уведомления."
          : "Подтвердите действие кодом из письма.",
    });
  } catch (error) {
    redirectByMailError(error);
  }

  revalidatePath("/dashboard/account");
  redirect("/dashboard/account?emailStatus=resent");
}

export async function sendOwnPasswordChangeCodeAction() {
  const session = await requireUser();
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      isEmailPlaceholder: true,
    },
  });

  if (!user || user.isEmailPlaceholder || !user.emailVerified) {
    redirect("/dashboard/account?passwordStatus=no_verified_email");
  }

  try {
    await issueEmailCode({
      identifier: buildPasswordChangeIdentifier(user.id, user.email),
      email: user.email,
      subject: "1VPN: код для смены пароля",
      title: "Смена пароля",
      description: "Введите этот код в личном кабинете и задайте новый пароль.",
    });
  } catch (error) {
    redirectByMailError(error, "passwordStatus");
  }

  revalidatePath("/dashboard/account");
  redirect("/dashboard/account?passwordStatus=sent");
}

export async function updateOwnPasswordAction(formData: FormData) {
  const session = await requireUser();
  const code = parseRequiredString(formData.get("code"));
  const newPassword = parseRequiredString(formData.get("newPassword"));

  if (newPassword.length < 8 || newPassword.length > 64 || Buffer.byteLength(newPassword) > 72) {
    redirect("/dashboard/account?passwordStatus=weak_password");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      isEmailPlaceholder: true,
      authVersion: true,
    },
  });

  if (!user) {
    redirect("/dashboard/account?passwordStatus=user_not_found");
  }

  if (user.isEmailPlaceholder || !user.emailVerified) {
    redirect("/dashboard/account?passwordStatus=no_verified_email");
  }

  const isValid = await consumeEmailCode(buildPasswordChangeIdentifier(user.id, user.email), code, async (tx) => {
    await tx.user.update({
      where: { id: user.id, email: user.email, authVersion: user.authVersion, isBanned: false },
      data: {
        passwordHash: await hashPassword(newPassword),
        authVersion: { increment: 1 },
      },
    });
  });
  if (!isValid) {
    redirect("/dashboard/account?passwordStatus=invalid_code");
  }

  revalidatePath("/dashboard/account");
  redirect("/login");
}

export async function deleteOwnHwidDeviceAction(formData: FormData) {
  const session = await requireUser();
  const hwid = parseRequiredString(formData.get("hwid"));

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      remnawaveUserUuid: true,
    },
  });

  if (!user?.remnawaveUserUuid) {
    throw new Error("VPN profile is not provisioned yet.");
  }

  await deleteRemoteUserDevice({
    remnawaveUserUuid: user.remnawaveUserUuid,
    hwid,
  });

  revalidatePath("/dashboard");
}

export async function runSyncNowAction() {
  await requireAdmin();
  await runLifecycleSweep();
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

export async function runProvisioningNowAction(formData: FormData) {
  const { user } = await requireAdmin();
  const config = getProvisioningConfig();
  if (config.enabled && !config.dryRun && formData.get("confirmPaidProvisioning") !== "on") {
    throw new Error("Подтвердите возможную покупку VPS.");
  }
  await runProvisioningSweep(user.id);
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

export async function syncUserNowAction(formData: FormData) {
  await requireAdmin();
  const userId = await resolveUserIdentifier(String(formData.get("userId") ?? ""));
  await syncUserLifecycle(userId);
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

export async function refreshRemnawaveStatusAction(
  previousStatus: RemnawaveConnectionStatus,
): Promise<RemnawaveConnectionStatus> {
  void previousStatus;
  await requireAdmin();
  return checkRemnawaveConnection();
}
