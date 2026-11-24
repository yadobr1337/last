import {
  resendOwnEmailVerificationAction,
  sendOwnPasswordChangeCodeAction,
  updateOwnEmailAction,
  updateOwnPasswordAction,
  verifyOwnEmailAction,
} from "@/app/actions";
import { ConsoleShell } from "@/components/console-shell";
import { TelegramBotLink } from "@/components/telegram-bot-link";
import { LogoutButton } from "@/components/logout-button";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { PageHeader, SectionHeader } from "@/components/ui/page";
import { PendingButton } from "@/components/ui/pending-button";
import { PasswordInput } from "@/components/ui/password-input";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { DEFAULT_SUPPORT_TELEGRAM_URL } from "@/lib/site";

function getEmailStatusMessage(status?: string) {
  switch (status) {
    case "sent":
      return { tone: "success", text: "Код отправлен на email." };
    case "resent":
      return { tone: "success", text: "Код отправлен повторно." };
    case "verified":
      return { tone: "success", text: "Email подтвержден." };
    case "smtp_missing":
    case "smtp_auth_error":
    case "smtp_connection_error":
    case "send_error":
      return { tone: "error", text: "Не удалось отправить код. Попробуйте позже." };
    case "invalid_email":
      return { tone: "error", text: "Укажите действительный email." };
    case "email_exists":
      return { tone: "error", text: "Этот email уже используется другим аккаунтом." };
    case "invalid_code":
      return { tone: "error", text: "Неверный или просроченный код." };
    case "no_pending_email":
      return { tone: "error", text: "Сначала запросите код для email." };
    default:
      return null;
  }
}

function getPasswordStatusMessage(status?: string) {
  switch (status) {
    case "sent":
      return { tone: "success", text: "Код для смены пароля отправлен на email." };
    case "updated":
      return { tone: "success", text: "Пароль обновлён." };
    case "smtp_missing":
    case "smtp_auth_error":
    case "smtp_connection_error":
    case "send_error":
      return { tone: "error", text: "Не удалось отправить код. Попробуйте позже." };
    case "invalid_code":
      return { tone: "error", text: "Неверный или просроченный код для смены пароля." };
    case "weak_password":
      return { tone: "error", text: "Новый пароль должен быть от 8 до 64 символов." };
    case "no_verified_email":
      return { tone: "error", text: "Сначала подтвердите email, чтобы получать коды." };
    case "user_not_found":
      return { tone: "error", text: "Аккаунт не найден. Войдите заново." };
    default:
      return null;
  }
}

type SearchParamsInput =
  | Promise<{ emailStatus?: string | string[]; passwordStatus?: string | string[] }>
  | { emailStatus?: string | string[]; passwordStatus?: string | string[] }
  | undefined;

export default async function DashboardAccountPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const session = await requireUser();
  const params = searchParams ? await searchParams : {};
  const emailStatus = Array.isArray(params.emailStatus) ? params.emailStatus[0] : params.emailStatus;
  const passwordStatus = Array.isArray(params.passwordStatus)
    ? params.passwordStatus[0]
    : params.passwordStatus;
  const statusMessage = getEmailStatusMessage(emailStatus);
  const passwordStatusMessage = getPasswordStatusMessage(passwordStatus);
  const supportTelegramUrl = env.NEXT_PUBLIC_SUPPORT_TELEGRAM_URL ?? DEFAULT_SUPPORT_TELEGRAM_URL;

  const publicId = session.user.publicId;
  const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        emailVerified: true,
        telegramId: true,
        telegramUsername: true,
        telegramBotConfirmedAt: true,
        isEmailPlaceholder: true,
      },
  });

  if (!user) return null;

  const hasRealEmail = !user.isEmailPlaceholder;
  const emailLabel = hasRealEmail ? user.email : "Email не привязан";


  return (
    <ConsoleShell area="account" isAdmin={session.user.role === "ADMIN"}>
      <PageHeader title="Настройки аккаунта" description={<><span>ID {publicId}</span> · {emailLabel}</>}>
        <LogoutButton />
      </PageHeader>

      {[statusMessage, passwordStatusMessage].map((message) => message ? (
        <aside key={message.text}><Notice tone={message.tone === "error" ? "danger" : "success"}>{message.text}</Notice></aside>
      ) : null)}

      <section className="console-grid" aria-label="Почта и пароль">
        <Card id="email" className="console-section space-y-4">
          <SectionHeader title="Email" description="Подтверждённый адрес нужен для восстановления пароля." />
          <StatusBadge tone={user.emailVerified && !user.pendingEmail ? "success" : "warning"}>
            {user.emailVerified && !user.pendingEmail ? "Подтверждён" : "Требуется подтверждение"}
          </StatusBadge>
          <form action={updateOwnEmailAction} className="grid gap-3">
            <label className="grid gap-2 text-sm text-muted">
              {hasRealEmail ? "Изменить email" : "Добавить email"}
              <Input defaultValue={user.pendingEmail ?? (hasRealEmail ? user.email : "")}
                name="email" placeholder="you@domain.com" type="email" autoComplete="email" required />
            </label>
            <div><PendingButton>{hasRealEmail ? "Отправить код на новый email" : "Отправить код"}</PendingButton></div>
          </form>
          {user.pendingEmail || (hasRealEmail && !user.emailVerified) ? (
            <div className="grid gap-3 border-t border-line pt-4">
              <p className="break-words text-sm text-muted">
                {user.pendingEmail ? "Ожидает подтверждения " + user.pendingEmail : "Текущий email ещё не подтверждён."}
              </p>
              <form action={verifyOwnEmailAction} className="flex flex-wrap items-end gap-2">
                <label className="grid min-w-0 flex-1 basis-28 gap-2 text-sm text-muted">
                  Код из письма
                  <Input name="code" placeholder="123456" inputMode="numeric" autoComplete="one-time-code" required />
                </label>
                <PendingButton>Подтвердить</PendingButton>
              </form>
              <form action={resendOwnEmailVerificationAction}>
                <PendingButton variant="ghost">Отправить код повторно</PendingButton>
              </form>
            </div>
          ) : null}
        </Card>

        <Card id="password" className="console-section space-y-4">
          <SectionHeader title="Пароль" description="Код для смены пароля приходит на подтверждённую почту и действует 10 минут." />
          <form action={sendOwnPasswordChangeCodeAction}>
            <PendingButton variant="ghost">Отправить код для смены пароля</PendingButton>
          </form>
          <form action={updateOwnPasswordAction} className="grid gap-3">
            <label className="grid gap-2 text-sm text-muted">
              Код из письма
              <Input inputMode="numeric" name="code" placeholder="123456" autoComplete="one-time-code" required />
            </label>
            <label className="grid gap-2 text-sm text-muted">
              Новый пароль
              <PasswordInput name="newPassword" autoComplete="new-password" minLength={8} required />
            </label>
            <div><PendingButton>Сохранить пароль</PendingButton></div>
          </form>
        </Card>
      </section>

      <section className="console-grid" aria-label="Telegram и поддержка">
        <Card id="telegram" className="console-section space-y-4">
          <SectionHeader title="Telegram" description="Привяжите бота, чтобы получать уведомления о балансе и подписке." />
          <StatusBadge tone={user.telegramBotConfirmedAt ? "success" : "neutral"}>
            {user.telegramBotConfirmedAt ? "@" + (user.telegramUsername ?? user.telegramId)
              : user.telegramId ? "Требуется подтверждение в боте" : "Telegram не привязан"}
          </StatusBadge>
          {user.telegramBotConfirmedAt ? <Notice tone="success">Telegram привязан к текущему аккаунту.</Notice> : <TelegramBotLink />}
        </Card>
        <Card>
          <SectionHeader title="Поддержка" />
          <div className="flex flex-wrap gap-2">
            {supportTelegramUrl ? <ButtonLink href={supportTelegramUrl} variant="ghost" target="_blank" rel="noreferrer">Поддержка в Telegram</ButtonLink> : null}
            {env.SUPPORT_EMAIL ? <ButtonLink href={"mailto:" + env.SUPPORT_EMAIL} variant="ghost">{env.SUPPORT_EMAIL}</ButtonLink> : null}
          </div>
        </Card>
      </section>
    </ConsoleShell>
  );
}
