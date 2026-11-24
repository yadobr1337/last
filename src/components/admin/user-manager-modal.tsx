"use client";

import { useActionState, useId, useState } from "react";
import { adjustUserBalanceAction, type AdminBalanceActionState, syncUserNowAction,
  toggleBanAction, updateUserHwidAction } from "@/app/actions";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmSubmit, Modal } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { PendingButton } from "@/components/ui/pending-button";

type AdminUserTransaction = {
  id: string;
  label: string;
  description: string;
  amount: string;
  positive: boolean;
  createdAt: string;
};

export type AdminUserManagerData = {
  id: string;
  publicId: string;
  email: string;
  squadName: string;
  remnawaveUserUuid: string;
  subscriptionUrl: string;
  balance: string;
  remainingDays: string;
  deviceCount: number;
  hwidDeviceLimit: number | null;
  defaultHwidDeviceLimit: number;
  vpnStatus: string;
  vpnProvisionState: string;
  vpnStatusMessage: string;
  isBanned: boolean;
  transactions: AdminUserTransaction[];
};

const initialBalanceState: AdminBalanceActionState = {
  status: "idle",
  message: "",
};


function BalanceAdjustmentForm({ userId, operation }: { userId: string; operation: "credit" | "debit" }) {
  const [state, action] = useActionState(adjustUserBalanceAction, initialBalanceState);
  const credit = operation === "credit";
  return (
    <form action={action} className="grid gap-3 rounded-xl border border-line bg-background p-3">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="operation" value={operation} />
      <h3 className="font-semibold">{credit ? "Зачислить на баланс" : "Списать с баланса"}</h3>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,.7fr)_minmax(0,1fr)]">
        <label className="grid gap-2 text-sm text-muted">Сумма, ₽
          <Input min="0.01" name="amount" required step="0.01" type="number" />
        </label>
        <label className="grid gap-2 text-sm text-muted">Комментарий
          <Input name="description" type="text" />
        </label>
      </div>
      <ConfirmSubmit variant={credit ? "primary" : "danger"}
        label={credit ? "Зачислить" : "Списать"}
        message={credit ? "Сумма будет зачислена на баланс этого пользователя." : "Сумма будет списана с баланса этого пользователя."}>
        {credit ? "Зачислить" : "Списать"}
      </ConfirmSubmit>
      {state.message ? <Notice tone={state.status === "error" ? "danger" : "success"}>{state.message}</Notice> : null}
    </form>
  );
}

export function UserManagerModal({ user }: { user: AdminUserManagerData }) {
  const [open, setOpen] = useState(true);
  const trigger = useId();
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-background p-3">
        <div className="min-w-0">
          <p className="break-words font-semibold">{user.email}</p>
          <p className="text-sm text-muted">ID {user.publicId}</p>
        </div>
        <Button id={trigger} type="button" variant="ghost" onClick={() => setOpen(true)}>Открыть карточку</Button>
      </div>
      <Modal open={open} onClose={() => {
        setOpen(false);
        window.requestAnimationFrame(() => document.getElementById(trigger)?.focus({ preventScroll: true }));
      }} title={"Пользователь " + user.publicId} description={user.email} layout="drawer">
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <InfoCard label="Баланс" value={user.balance} />
            <InfoCard label="Остаток" value={user.remainingDays} />
            <InfoCard label="Устройства" value={String(user.deviceCount)} />
            <InfoCard label="Подписка" value={<StatusBadge tone={user.isBanned ? "danger" : user.vpnProvisionState === "ACTIVE" ? "success" : "neutral"}>{user.vpnStatus}</StatusBadge>} />
          </div>

          <div className="ui-card grid gap-3">
            <h3 className="text-lg font-semibold">Подписка в Remnawave</h3>
            <Notice tone={user.vpnProvisionState === "ERROR" ? "danger" : "neutral"}>{user.vpnStatusMessage}</Notice>
            <p className="break-words text-sm text-muted">Сквад {user.squadName}</p>
            <p className="break-all text-sm text-muted">UUID {user.remnawaveUserUuid}</p>
            <code className="subscription-link">{user.subscriptionUrl}</code>
            <form action={syncUserNowAction}>
              <input type="hidden" name="userId" value={user.id} />
              <PendingButton variant="ghost">Повторить синхронизацию</PendingButton>
            </form>
          </div>

          <div className="ui-card grid gap-3">
            <h3 className="text-lg font-semibold">Устройства и доступ</h3>
            <form action={updateUserHwidAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="userId" value={user.id} />
              <label className="grid flex-1 basis-40 gap-2 text-sm text-muted">Лимит устройств
                <Input defaultValue={user.hwidDeviceLimit ?? ""} min="1" max="100" name="hwidDeviceLimit"
                  placeholder={"По умолчанию " + user.defaultHwidDeviceLimit} type="number" />
              </label>
              <PendingButton variant="ghost">Сохранить</PendingButton>
            </form>
            <form action={toggleBanAction}>
              <input type="hidden" name="userId" value={user.id} />
              <input type="hidden" name="ban" value={String(!user.isBanned)} />
              <ConfirmSubmit variant={user.isBanned ? "ghost" : "danger"}
                label={user.isBanned ? "Разблокировать" : "Заблокировать"}
                message={user.isBanned ? "Пользователь снова сможет войти в кабинет." : "Пользователь потеряет доступ к кабинету и VPN."}>
                {user.isBanned ? "Разблокировать пользователя" : "Заблокировать пользователя"}
              </ConfirmSubmit>
            </form>
          </div>

          <div className="ui-card grid gap-3">
            <h3 className="text-lg font-semibold">Управление балансом</h3>
            <BalanceAdjustmentForm userId={user.id} operation="credit" />
            <BalanceAdjustmentForm userId={user.id} operation="debit" />
          </div>

          <div className="ui-card grid gap-3">
            <h3 className="text-lg font-semibold">История операций</h3>
            {user.transactions.length ? (
              <ul>
                {user.transactions.map((transaction) => (
                  <li key={transaction.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-line py-3 last:border-0">
                    <div className="min-w-0">
                      <p className="font-semibold">{transaction.label}</p>
                      <p className="break-words text-sm text-muted">{transaction.description}</p>
                    </div>
                    <div>
                      <p className={transaction.positive ? "font-semibold text-emerald-300" : "font-semibold"}>
                        {transaction.positive ? "+" : ""}{transaction.amount}
                      </p>
                      <p className="text-sm text-subtle">{transaction.createdAt}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState>Операций пока нет.</EmptyState>}
          </div>
        </div>
      </Modal>
    </>
  );
}

function InfoCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="ui-card">
      <p className="text-sm text-muted">{label}</p>
      <div className="mt-2 font-semibold tabular-nums">{value}</div>
    </div>
  );
}
