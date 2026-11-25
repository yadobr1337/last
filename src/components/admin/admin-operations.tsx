"use client";

import { useActionState, useState } from "react";
import { Gift, Radio, Wrench } from "lucide-react";
import {
  broadcastTelegramAction, grantDaysToAllUsersAction, updateMaintenanceAction,
  type AdminOperationActionState,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckField } from "@/components/ui/check-field";
import { ConfirmSubmit, Modal } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { PendingButton } from "@/components/ui/pending-button";
import { TELEGRAM_ANNOUNCEMENT_MAX_LENGTH } from "@/lib/telegram-templates";

type Operation = "days" | "maintenance" | "broadcast";
const initialState: AdminOperationActionState = { status: "idle", message: "" };

function ResultMessage({ state }: { state: AdminOperationActionState }) {
  if (!state.message) return null;
  return <Notice tone={state.status === "error" ? "danger" : "success"}>{state.message}</Notice>;
}

export function AdminOperations({ maintenanceEnabled, maintenanceMessage }: {
  maintenanceEnabled: boolean; maintenanceMessage: string | null;
}) {
  const [operation, setOperation] = useState<Operation | null>(null);
  const [grantRequestId, setGrantRequestId] = useState("");
  const [daysState, daysAction] = useActionState(grantDaysToAllUsersAction, initialState);
  const [maintenanceState, maintenanceAction] = useActionState(updateMaintenanceAction, initialState);
  const [broadcastState, broadcastAction] = useActionState(broadcastTelegramAction, initialState);
  const close = () => setOperation(null);
  const cards = [
    { operation: "days", id: "gift-days", icon: Gift, title: "Подарочные дни", description: "Пополните баланс всех пользователей на выбранное число дней.", label: "Начислить дни" },
    { operation: "maintenance", id: "maintenance-controls", icon: Wrench, title: "Технический режим", description: "Покажите посетителям сообщение о работах. Доступ администраторов сохранится.", label: maintenanceEnabled ? "Режим включён" : "Настроить режим" },
    { operation: "broadcast", id: "broadcast", icon: Radio, title: "Telegram-рассылка", description: "Отправьте сообщение пользователям, которые привязали Telegram через бота.", label: "Создать рассылку" },
  ] as const;

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-3">
        {cards.map(({ operation: target, id, title, description, label, icon: Icon }) => (
          <Card id={id} key={target} className="console-section flex flex-col items-start gap-3">
            <span className="benefit-icon"><Icon size={21} aria-hidden="true" /></span>
            <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
            <p className="mb-1 text-sm leading-relaxed text-muted">{description}</p>
            <Button type="button" variant="ghost" className="mt-auto" onClick={() => {
              if (target === "days") setGrantRequestId(crypto.randomUUID());
              setOperation(target);
            }}>{label}</Button>
          </Card>
        ))}
      </div>

      <Modal open={operation === "days"} onClose={close} title="Начислить дни всем"
        description="Сумма начисления зависит от тарифа и лимита устройств пользователя.">
        <form action={daysAction} className="space-y-4">
          <input type="hidden" name="requestId" value={grantRequestId} />
          <label className="grid gap-2 text-sm text-muted">Количество дней
            <Input min="1" max="3650" name="days" type="number" required />
          </label>
          <label className="grid gap-2 text-sm text-muted">Сообщение пользователям
            <textarea className="ui-input" name="description" maxLength={300} placeholder="Например, подарок за технические работы" />
          </label>
          <ConfirmSubmit message="Баланс пополнится у всех пользователей." label="Начислить дни">Начислить всем</ConfirmSubmit>
          <ResultMessage state={daysState} />
        </form>
      </Modal>

      <Modal open={operation === "maintenance"} onClose={close} title="Технический режим"
        description="В этом режиме пользователи увидят страницу технических работ.">
        <form action={maintenanceAction} className="space-y-4">
          <CheckField variant="switch" name="enabled" defaultChecked={maintenanceEnabled}>Включить технический режим</CheckField>
          <label className="grid gap-2 text-sm text-muted">Сообщение на странице
            <textarea className="ui-input" defaultValue={maintenanceMessage ?? ""} name="message"
              placeholder="Сообщите пользователям о работах" />
          </label>
          <PendingButton>Сохранить режим</PendingButton>
          <ResultMessage state={maintenanceState} />
        </form>
      </Modal>

      <Modal open={operation === "broadcast"} onClose={close} title="Telegram-рассылка"
        description="Добавьте текст и, при необходимости, изображение.">
        <form action={broadcastAction} className="space-y-4">
          <label className="grid gap-2 text-sm text-muted">Текст сообщения
            <textarea className="ui-input" maxLength={TELEGRAM_ANNOUNCEMENT_MAX_LENGTH} name="text" placeholder="Введите текст рассылки" required />
          </label>
          <label className="grid gap-2 text-sm text-muted">Изображение до 7 МБ, необязательно
            <Input accept="image/*" name="photo" type="file" />
          </label>
          <ConfirmSubmit message="Сообщение получат пользователи, подтвердившие привязку через бота." label="Отправить">Отправить рассылку</ConfirmSubmit>
          <ResultMessage state={broadcastState} />
        </form>
      </Modal>
    </>
  );
}
