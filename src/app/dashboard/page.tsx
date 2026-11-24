import { Suspense } from "react";
import { CircleDollarSign, Clock3, Gift, ShieldCheck, Smartphone, Wallet } from "lucide-react";
import {
  claimTrialAction,
  createYooKassaPaymentAction,
  deleteOwnHwidDeviceAction,
  updateOwnHwidAction,
} from "@/app/actions";
import { BillingModal } from "@/components/billing-modal";
import { ConsoleShell } from "@/components/console-shell";
import { CopyButton } from "@/components/copy-button";
import { DeviceStepperForm } from "@/components/device-stepper-form";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmSubmit } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Notice, Skeleton } from "@/components/ui/feedback";
import { PageHeader, SectionHeader, StatCard } from "@/components/ui/page";
import { PendingButton } from "@/components/ui/pending-button";
import { requireUser } from "@/lib/auth";
import { getUserOverview } from "@/lib/billing";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getRemoteUserDevices } from "@/lib/remnawave";
import { DEFAULT_SUPPORT_TELEGRAM_URL } from "@/lib/site";
import { formatCurrency, formatDays } from "@/lib/utils";
import { canUseYooKassa } from "@/lib/yookassa";

function subscriptionStatus(balance: number, state: string, banned: boolean) {
  if (banned) return { label: "Заблокирована", tone: "danger" } as const;
  if (balance <= 0) return { label: "Ожидает оплаты", tone: "neutral" } as const;
  if (state === "ACTIVE") return { label: "Активна", tone: "success" } as const;
  if (state === "ERROR") return { label: "Ошибка панели", tone: "danger" } as const;
  return { label: "Синхронизация", tone: "warning" } as const;
}

async function DeviceList({ remnawaveUserUuid }: { remnawaveUserUuid?: string | null }) {
  let devices: Awaited<ReturnType<typeof getRemoteUserDevices>>;
  try {
    devices = await getRemoteUserDevices(remnawaveUserUuid, AbortSignal.timeout(5_000));
  } catch {
    return <ErrorState>Панель VPN не ответила. Обновите страницу, чтобы повторить запрос.</ErrorState>;
  }

  if (!devices.length) return <EmptyState>Устройства появятся после подключения через VPN-приложение.</EmptyState>;

  return (
    <ul className="grid gap-2">
      {devices.map((device) => (
        <li key={device.hwid} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-black/20 px-3 py-3">
          <div className="min-w-0">
            <p className="font-semibold">{device.deviceModel || device.platform || "Устройство " + device.hwid.slice(0, 8)}</p>
            <p className="break-all font-mono text-xs text-subtle">HWID {device.hwid}</p>
            <p className="mt-1 text-sm text-muted">Последний вход {device.updatedAt.toLocaleString("ru-RU")}</p>
          </div>
          <form action={deleteOwnHwidDeviceAction}>
            <input type="hidden" name="hwid" value={device.hwid} />
            <ConfirmSubmit size="sm" variant="danger" label="Удалить устройство"
              message="Устройство будет удалено из списка VPN. При необходимости его можно подключить заново.">Удалить</ConfirmSubmit>
          </form>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage() {
  const session = await requireUser();
  const publicId = session.user.publicId;
  const [overview, transactions] = await Promise.all([
    getUserOverview(session.user.id),
    db.balanceTransaction.findMany({
      where: {
        userId: session.user.id,
        amountKopeks: {
          gt: 0,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  if (!overview) {
    return null;
  }

  const canClaimTrial = !overview.user.trialClaimedAt;
  const hasLinkedTelegram = Boolean(overview.user.telegramBotConfirmedAt);
  const hasRealEmail = !overview.user.isEmailPlaceholder;
  const emailNeedsVerification = Boolean(
    overview.user.pendingEmail || (hasRealEmail && !overview.user.emailVerified),
  );
  const supportTelegramUrl =
    env.NEXT_PUBLIC_SUPPORT_TELEGRAM_URL ??
    overview.settings.supportTelegramUrl ??
    DEFAULT_SUPPORT_TELEGRAM_URL;


  const status = subscriptionStatus(
    overview.user.balanceKopeks, overview.user.vpnProvisionState, overview.user.isBanned,
  );
  const subscriptionUrl = overview.user.subscriptionUrl;
  const dailyPrice = overview.settings.pricePerDayKopeks;

  return (
    <ConsoleShell area="dashboard" isAdmin={session.user.role === "ADMIN"}>
      <PageHeader title="Подписка и баланс" description={
        <><span>ID {publicId}</span> · {hasRealEmail ? overview.user.email : "Email не привязан"}</>
      }>
        <BillingModal paymentsEnabled={canUseYooKassa()} topUpAction={createYooKassaPaymentAction}
          transactions={transactions.map((transaction) => ({
            id: transaction.id,
            description: transaction.description,
            amount: formatCurrency(transaction.amountKopeks),
            createdAt: transaction.createdAt.toLocaleString("ru-RU"),
          }))} />
      </PageHeader>

      <section className="console-stats" aria-label="Показатели подписки">
        <StatCard label="Баланс" value={formatCurrency(overview.user.balanceKopeks)}
          icon={<Wallet size={19} aria-hidden="true" />} />
        <StatCard label="Осталось дней" value={formatDays(overview.remainingDays)}
          icon={<Clock3 size={19} aria-hidden="true" />} />
        <StatCard label="Расход в день" value={formatCurrency(dailyPrice * overview.effectiveHwidDeviceLimit)}
          icon={<CircleDollarSign size={19} aria-hidden="true" />}>
          {formatCurrency(dailyPrice)} за устройство
        </StatCard>
      </section>

      {emailNeedsVerification ? <aside>
        <Notice className="flex-wrap items-center justify-between" tone="warning">
          <span>{!hasRealEmail ? "Добавьте email для восстановления доступа и уведомлений." : "Подтвердите email кодом из письма."}</span>
          <ButtonLink href="/dashboard/account#email" size="sm" variant="ghost">Настройки email</ButtonLink>
        </Notice>
      </aside> : null}
      {overview.user.isBanned ? <aside><ErrorState>Аккаунт заблокирован. VPN-доступ приостановлен.</ErrorState></aside> : null}

      <section className="console-grid" aria-label="Подключение и устройства">
        <Card id="connection" className="connection-panel console-section space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="benefit-icon"><ShieldCheck size={23} aria-hidden="true" /></div>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </div>
          <SectionHeader title="Подключение к VPN" description="Ссылка доступа к вашей подписке." />
          {subscriptionUrl ? (
            <>
              <code className="subscription-link">{subscriptionUrl}</code>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={subscriptionUrl} target="_blank" rel="noreferrer">Подключиться</ButtonLink>
                <CopyButton value={subscriptionUrl} />
              </div>
            </>
          ) : <EmptyState>Ссылка появится после пополнения или активации пробного периода и синхронизации с VPN-панелью.</EmptyState>}
          <details className="faq-item">
            <summary>Инструкция по подключению</summary>
            <ol className="faq-answer list-decimal space-y-1 pl-5">
              <li>Откройте VPN-приложение с поддержкой ссылок подписок.</li>
              <li>Скопируйте вашу ссылку из кабинета и добавьте её в приложение.</li>
              <li>Выберите доступный сервер в приложении и включите VPN.</li>
            </ol>
          </details>
        </Card>

        <Card id="devices" className="console-section space-y-4">
          <div className="benefit-icon"><Smartphone size={22} aria-hidden="true" /></div>
          <SectionHeader title="Устройства" description="Управляйте лимитом и удаляйте ненужные устройства." />
          <DeviceStepperForm action={updateOwnHwidAction} currentValue={overview.effectiveHwidDeviceLimit} />
          <Suspense fallback={<div role="status" className="grid gap-2"><span className="text-sm text-muted">Загружаем устройства…</span><Skeleton className="h-16" /></div>}>
            <DeviceList remnawaveUserUuid={overview.user.remnawaveUserUuid} />
          </Suspense>
        </Card>
      </section>

      {canClaimTrial ? <section>
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="benefit-icon shrink-0"><Gift size={21} aria-hidden="true" /></span>
            <div>
              <h2 className="text-lg font-semibold">Пробный период</h2>
              <p className="mt-1 text-sm text-muted">{overview.settings.trialDays} дн. доступа после подтверждения Telegram.</p>
            </div>
          </div>
          {hasLinkedTelegram ? <form action={claimTrialAction}><PendingButton>Активировать пробный период</PendingButton></form>
            : <ButtonLink href="/dashboard/account#telegram" variant="ghost">Привязать Telegram</ButtonLink>}
        </Card>
      </section> : null}

      <section id="support" className="console-grid console-section" aria-label="Условия и поддержка">
        <Card>
          <SectionHeader title="Условия подписки" />
          <p className="text-muted leading-relaxed">При нулевом балансе доступ приостанавливается. Пополните его в течение {overview.settings.deletionGraceHours} ч, чтобы сохранить ссылку.</p>
          <p className="mt-2 text-sm text-subtle">Telegram {overview.user.telegramId ?? "не привязан"}</p>
        </Card>
        <Card>
          <SectionHeader title="Поддержка" />
          <div className="flex flex-wrap gap-2">
            {supportTelegramUrl ? <ButtonLink href={supportTelegramUrl} target="_blank" rel="noreferrer" variant="ghost">Telegram</ButtonLink> : null}
            {env.SUPPORT_EMAIL ? <ButtonLink href={"mailto:" + env.SUPPORT_EMAIL} variant="ghost">{env.SUPPORT_EMAIL}</ButtonLink> : null}
          </div>
        </Card>
      </section>
    </ConsoleShell>
  );
}
