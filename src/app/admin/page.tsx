import { Role, TransactionType, VpnProvisionState } from "@prisma/client";
import { Activity, CircleDollarSign, Search, ShieldCheck, Users, Wallet } from "lucide-react";
import { ConsoleShell } from "@/components/console-shell";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckField } from "@/components/ui/check-field";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { PageHeader, SectionHeader, StatCard } from "@/components/ui/page";
import { PendingButton } from "@/components/ui/pending-button";
import { Tabs } from "@/components/ui/tabs";
import { RemnawaveStatusCard } from "@/components/admin/remnawave-status-card";
import { AdminOperations } from "@/components/admin/admin-operations";
import { SiteRestartCard } from "@/components/admin/site-restart-card";
import { SquadManager } from "@/components/admin/squad-manager";
import { UserManagerModal, type AdminUserManagerData } from "@/components/admin/user-manager-modal";
import { runProvisioningNowAction, runSyncNowAction, updateSettingsAction } from "@/app/actions";
import { requireAdmin } from "@/lib/auth";
import { getCaptchaSiteKey } from "@/lib/captcha";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { checkRemnawaveConnection } from "@/lib/remnawave";
import { getProvisioningOverview } from "@/lib/provisioning";
import { formatCurrency, formatDays } from "@/lib/utils";

function getVpnStatusLabel(params: {
  isBanned: boolean;
  balanceKopeks: number;
  vpnProvisionState: VpnProvisionState;
}) {
  if (params.isBanned) {
    return "Заблокирован";
  }

  if (params.balanceKopeks <= 0) {
    return "Ожидает оплаты";
  }

  if (params.vpnProvisionState === VpnProvisionState.ACTIVE) {
    return "Активный";
  }

  if (params.vpnProvisionState === VpnProvisionState.ERROR) {
    return "Ошибка панели";
  }

  return "Синхронизация";
}

function getTransactionLabel(type: TransactionType) {
  switch (type) {
    case TransactionType.TOPUP:
      return "Пополнение";
    case TransactionType.ADMIN_ADJUSTMENT:
      return "Ручное изменение";
    case TransactionType.TRIAL:
      return "Пробный день";
    case TransactionType.BILLING_DEBIT:
      return "Списание";
    default:
      return type;
  }
}

function getPeriodStart(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (days - 1));
  return date;
}

async function getAdminStats(periodStart: Date) {
  const [newUsers, buyers] = await Promise.all([
    db.user.count({
      where: {
        role: Role.USER,
        createdAt: {
          gte: periodStart,
        },
      },
    }),
    db.balanceTransaction.groupBy({
      by: ["userId"],
      where: {
        type: TransactionType.TOPUP,
        amountKopeks: {
          gt: 0,
        },
        createdAt: {
          gte: periodStart,
        },
        user: {
          role: Role.USER,
        },
      },
    }),
  ]);

  return {
    newUsers,
    buyers: buyers.length,
  };
}

type SearchParamsInput = Promise<{ user?: string | string[] }> | { user?: string | string[] } | undefined;

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  await requireAdmin();
  const captchaConfigured = Boolean(getCaptchaSiteKey());

  const params = searchParams ? await searchParams : {};
  const userQuery = Array.isArray(params.user) ? params.user[0] : params.user;
  const normalizedQuery = userQuery?.trim();

  const [
    settings,
    userStats,
    squads,
    searchedUser,
    remnawaveStatus,
    provisioning,
    todayStats,
    weekStats,
    monthStats,
    queuedNotifications,
    failedNotifications,
    auditEvents,
    activeSubscriptions,
    payments,
  ] = await Promise.all([
    getSettings(),
    db.user.aggregate({
      _count: {
        id: true,
      },
      _sum: {
        balanceKopeks: true,
      },
      where: {
        role: Role.USER,
      },
    }),
    db.squad.findMany({
      include: {
        _count: {
          select: { users: true },
        },
      },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    normalizedQuery
      ? db.user.findFirst({
          where: {
            OR: [
              { id: normalizedQuery },
              { publicId: normalizedQuery },
              { email: normalizedQuery.toLowerCase() },
            ],
          },
          include: {
            squad: true,
            transactions: {
              orderBy: { createdAt: "desc" },
              take: 8,
            },
          },
        })
      : Promise.resolve(null),
    checkRemnawaveConnection(),
    getProvisioningOverview(),
    getAdminStats(getPeriodStart(1)),
    getAdminStats(getPeriodStart(7)),
    getAdminStats(getPeriodStart(30)),
    db.notificationEvent.count({ where: { success: false, nextAttemptAt: { not: null } } }),
    db.notificationEvent.count({
      where: { success: false, nextAttemptAt: null, message: { not: "Telegram ID is not linked." } },
    }),
    db.adminAuditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, action: true, actor: true, target: true, createdAt: true },
    }),
    db.user.count({ where: { role: Role.USER, isBanned: false, balanceKopeks: { gt: 0 }, vpnProvisionState: "ACTIVE" } }),
    db.payment.findMany({
      orderBy: { createdAt: "desc" },
      take: 16,
      select: { id: true, status: true, amountKopeks: true, method: true, createdAt: true },
    }),
  ]);

  let user: AdminUserManagerData | null = null;
  if (searchedUser) {
    const deviceCount = Math.max(1, searchedUser.hwidDeviceLimit ?? settings.defaultHwidDeviceLimit);
    const remainingDays = settings.pricePerDayKopeks > 0
      ? searchedUser.balanceKopeks / (settings.pricePerDayKopeks * deviceCount) : 0;
    user = {
      id: searchedUser.id,
      publicId: searchedUser.publicId ?? "ожидается",
      email: searchedUser.email,
      squadName: searchedUser.squad?.name ?? "не назначен",
      remnawaveUserUuid: searchedUser.remnawaveUserUuid ?? "ещё не создан",
      subscriptionUrl: searchedUser.subscriptionUrl ?? "Ссылка подписки ещё не сгенерирована",
      balance: formatCurrency(searchedUser.balanceKopeks),
      remainingDays: formatDays(remainingDays),
      deviceCount,
      hwidDeviceLimit: searchedUser.hwidDeviceLimit,
      defaultHwidDeviceLimit: settings.defaultHwidDeviceLimit,
      vpnStatus: getVpnStatusLabel(searchedUser),
      vpnProvisionState: searchedUser.vpnProvisionState,
      vpnStatusMessage: searchedUser.vpnStatusMessage ?? "Синхронизация ещё не запускалась.",
      isBanned: searchedUser.isBanned,
      transactions: searchedUser.transactions.map((transaction) => ({
        id: transaction.id,
        label: getTransactionLabel(transaction.type),
        description: transaction.description,
        amount: formatCurrency(transaction.amountKopeks),
        positive: transaction.amountKopeks >= 0,
        createdAt: transaction.createdAt.toLocaleString("ru-RU"),
      })),
    };
  }

  return (
    <ConsoleShell area="admin" isAdmin>
      <PageHeader title="Управление 1VPN" description="Пользователи, подписки и инфраструктура сервиса.">
        <form action={runSyncNowAction}>
          <PendingButton variant="ghost"><Activity size={17} aria-hidden="true" />Запустить синхронизацию</PendingButton>
        </form>
      </PageHeader>

      <section id="overview" className="console-section space-y-3">
        <div className="console-stats admin-stats">
          <StatCard label="Пользователи" value={userStats._count.id} icon={<Users size={19} aria-hidden="true" />} />
          <StatCard label="Активные подписки" value={activeSubscriptions} icon={<ShieldCheck size={19} aria-hidden="true" />} />
          <StatCard label="Суммарный баланс" value={formatCurrency(userStats._sum.balanceKopeks ?? 0)}
            icon={<Wallet size={19} aria-hidden="true" />} />
          <StatCard label="Цена за день" value={formatCurrency(settings.pricePerDayKopeks)}
            icon={<CircleDollarSign size={19} aria-hidden="true" />} />
        </div>
        <Card>
          <SectionHeader title="Регистрации и покупатели" />
          <DataTable label="Регистрации по периодам" empty="Нет данных" columns={["Период", "Новые пользователи", "Покупатели"]}
            rows={[{ label: "Сегодня", stats: todayStats }, { label: "За 7 дней", stats: weekStats },
              { label: "За 30 дней", stats: monthStats }].map(({ label, stats }) => ({
                id: label, cells: [label, stats.newUsers, stats.buyers],
              }))} />
        </Card>
      </section>

      <section id="users" className="console-section">
        <Card className="space-y-4">
          <SectionHeader title="Пользователи" description="Найдите аккаунт по email, публичному или внутреннему ID." />
          <form className="flex flex-wrap items-end gap-2" method="get" action="/admin#users">
            <label className="grid min-w-0 flex-1 basis-48 gap-2 text-sm text-muted">
              Email или ID
              <Input defaultValue={normalizedQuery ?? ""} name="user" placeholder="Например, 12345678" type="search" />
            </label>
            <Button type="submit"><Search size={17} aria-hidden="true" />Найти пользователя</Button>
          </form>
          {user ? <UserManagerModal key={user.id} user={user} /> : normalizedQuery ? <EmptyState>Пользователь не найден.</EmptyState> : null}
        </Card>
      </section>

      <section id="finance" className="console-section space-y-3">
        <Card>
          <SectionHeader title="Платежи" description="Последние заказы пополнения." />
          <DataTable label="Платежи" columns={["Заказ", "Способ", "Сумма", "Статус", "Создан"]}
            empty="Платежей пока нет." filterLabel="Статус"
            rows={payments.map((payment) => ({
              id: payment.id,
              group: payment.status,
              cells: [
                <code key="id" className="text-xs text-muted">{payment.id}</code>,
                payment.method === "sbp" ? "СБП" : payment.method === "bank_card" ? "Карта" : payment.method,
                formatCurrency(payment.amountKopeks),
                <StatusBadge key="status" tone={payment.status === "SUCCEEDED" ? "success" : payment.status === "CANCELED" ? "danger" : "neutral"}>{payment.status}</StatusBadge>,
                payment.createdAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }),
              ],
            }))} />
        </Card>
        <Card>
          <SectionHeader title="Настройки" description="Тариф, пробный период и параметры сайта.">
            <a className="text-sm text-accent underline underline-offset-4" href="#gift-days">Подарочные дни</a>
          </SectionHeader>
          <form action={updateSettingsAction} className="grid gap-4">
            <Tabs label="Настройки сайта" items={[
              { title: "Тариф и подписка", content: (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm text-muted">Цена за день, ₽
                    <Input defaultValue={settings.pricePerDayKopeks / 100} name="pricePerDay" step="0.01" type="number" required />
                  </label>
                  <label className="grid gap-2 text-sm text-muted">Пробный период, дней
                    <Input defaultValue={settings.trialDays} name="trialDays" type="number" required />
                  </label>
                  <label className="grid gap-2 text-sm text-muted">Устройства по умолчанию
                    <Input defaultValue={settings.defaultHwidDeviceLimit} name="defaultHwidDeviceLimit" type="number" required />
                  </label>
                  <label className="grid gap-2 text-sm text-muted">Окно сохранения ссылки, ч
                    <Input defaultValue={settings.deletionGraceHours} name="deletionGraceHours" readOnly type="number" />
                  </label>
                </div>
              ) },
              { title: "Сайт и защита", content: (
                <div className="grid gap-3">
                  <label className="grid gap-2 text-sm text-muted">Ссылка на поддержку Telegram
                    <Input defaultValue={settings.supportTelegramUrl ?? ""} name="supportTelegramUrl" type="url" />
                  </label>
                  <label className="grid gap-2 text-sm text-muted">Анонс главной
                    <Input defaultValue={settings.heroAnnouncement ?? ""} name="heroAnnouncement" type="text" />
                  </label>
                  <CheckField variant="switch" name="captchaEnabled" defaultChecked={settings.captchaEnabled}
                    disabled={!settings.captchaEnabled && !captchaConfigured}>Включить Яндекс SmartCaptcha</CheckField>
                  {!captchaConfigured ? <p className="text-sm text-muted">Укажите ключи SmartCaptcha на сервере.</p> : null}
                </div>
              ) },
            ]} />
            <div><PendingButton>Сохранить настройки</PendingButton></div>
          </form>
        </Card>
      </section>

      <section id="vpn" className="console-section space-y-3">
        <RemnawaveStatusCard initialStatus={remnawaveStatus} />
        <Card>
          <SectionHeader title="Сквады" description="Добавьте UUID из Remnawave и задайте вместимость сквада." />
          <SquadManager squads={squads.map((squad) => ({
            id: squad.id, name: squad.name, memberLimit: squad.memberLimit, isActive: squad.isActive,
            remnawaveInternalSquadUuid: squad.remnawaveInternalSquadUuid, userCount: squad._count.users,
          }))} />
        </Card>
      </section>

      <section id="nodes" className="console-section">
        <Card className="space-y-4">
          <SectionHeader title="Серверы и ноды" description="Закупка VPS в Aeza, DNS в Timeweb и настройка в Remnawave." />
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={provisioning.config.enabled ? "success" : "neutral"}>{provisioning.config.enabled ? "Включено" : "Выключено"}</StatusBadge>
            <StatusBadge tone={provisioning.config.dryRun ? "neutral" : "warning"}>{provisioning.config.dryRun ? "Dry run" : "Платный режим"}</StatusBadge>
            <span className="ui-badge">Локации {provisioning.config.targets.length}</span>
            <span className="ui-badge">Нод на сквад {provisioning.config.nodesPerSquad}</span>
            <span className="ui-badge">Лимит сквадов {Math.floor(provisioning.config.maxServers / provisioning.config.nodesPerSquad)}</span>
            <span className="ui-badge">Лимит серверов {provisioning.config.maxServers}</span>
          </div>
          {provisioning.missing.length ? <Notice tone="warning">Заполните параметры закупки {provisioning.missing.join(", ")}</Notice> : null}
          <form action={runProvisioningNowAction} className="grid justify-items-start gap-3">
            {provisioning.config.enabled && !provisioning.config.dryRun ? (
              <CheckField name="confirmPaidProvisioning" required>Подтверждаю возможную покупку VPS</CheckField>
            ) : null}
            <PendingButton>Запустить автоподготовку</PendingButton>
          </form>
          <DataTable label="Задачи серверов" columns={["Нода", "Адрес", "Статус", "Подробности"]}
            filterLabel="Статус нод" pageSize={6} empty="Задачи появятся после запуска автоподготовки."
            rows={provisioning.jobs.map((job) => ({
              id: job.id,
              group: job.status,
              cells: [
                <div key="name"><strong>{job.nodeName}</strong><p className="text-sm text-muted">{job.locationName}</p></div>,
                <div key="address">{job.fqdn}{job.serverIp ? <p className="mt-1 font-mono text-xs text-muted">{job.serverIp}</p> : null}</div>,
                <StatusBadge key="status" tone={job.lastError ? "danger" : job.status === "ACTIVE" ? "success" : "neutral"}>{job.status}</StatusBadge>,
                <div key="details" className="space-y-1 text-sm">
                  {job.groupKey ? <p className="text-muted">{job.groupKey} · нода {job.nodeIndex ?? "—"}</p> : null}
                  {job.lastError ? <p className="text-red-300">{job.lastError}</p> : !job.groupKey ? "—" : null}
                </div>,
              ],
            }))} />
        </Card>
      </section>

      <section id="notifications" className="console-section space-y-3">
        <Card>
          <SectionHeader title="Уведомления" description="Состояние доставки сообщений Telegram." />
          <div className="flex flex-wrap gap-2">
            <StatusBadge>{queuedNotifications} в очереди</StatusBadge>
            <StatusBadge tone={failedNotifications ? "danger" : "neutral"}>{failedNotifications} ошибок доставки</StatusBadge>
          </div>
        </Card>
        <AdminOperations maintenanceEnabled={settings.maintenanceEnabled} maintenanceMessage={settings.maintenanceMessage} />
      </section>

      <section id="journal" className="console-section">
        <Card>
          <SectionHeader title="Журнал операций" description="Последние административные действия." />
          <DataTable label="Журнал операций" columns={["Дата", "Действие", "Исполнитель", "Объект"]}
            empty="Записей журнала пока нет." pageSize={6} rows={auditEvents.map((event) => ({
              id: event.id,
              cells: [
                <time key="date" dateTime={event.createdAt.toISOString()}>{event.createdAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</time>,
                <code key="action" className="text-xs">{event.action}</code>,
                event.actor,
                event.target ?? "—",
              ],
            }))} />
        </Card>
      </section>

      <section id="maintenance" className="console-section">
        <SectionHeader title="Обслуживание">
          <a href="#maintenance-controls" className="text-sm text-accent underline underline-offset-4">Технический режим</a>
        </SectionHeader>
        <SiteRestartCard />
      </section>
    </ConsoleShell>
  );
}
