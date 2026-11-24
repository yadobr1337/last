"use client";

import { useActionState } from "react";
import { createSquadAction, deleteSquadAction, updateSquadLimitAction, type SquadActionState } from "@/app/actions";
import { StatusBadge } from "@/components/ui/badge";
import { CheckField } from "@/components/ui/check-field";
import { ConfirmSubmit } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { PendingButton } from "@/components/ui/pending-button";

type SquadItem = {
  id: string; name: string; memberLimit: number; isActive: boolean;
  remnawaveInternalSquadUuid: string | null; userCount: number;
};

const initialState: SquadActionState = { status: "idle", message: "" };

function ActionMessage({ state }: { state: SquadActionState }) {
  return state.message ? <Notice tone={state.status === "error" ? "danger" : "success"}>{state.message}</Notice> : null;
}

function SquadRow({ squad }: { squad: SquadItem }) {
  const [updateState, updateAction, updatePending] = useActionState(updateSquadLimitAction, initialState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteSquadAction, initialState);

  return (
    <div className="grid gap-3 rounded-xl border border-line bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold break-words">{squad.name}</p>
        <StatusBadge tone={squad.isActive ? "success" : "neutral"}>{squad.isActive ? "Активен" : "Выключен"}</StatusBadge>
      </div>
      <form action={updateAction} className="grid gap-3">
        <input type="hidden" name="squadId" value={squad.id} />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(6rem,.6fr)]">
          <label className="grid gap-2 text-sm text-muted">Название
            <Input defaultValue={squad.name} name="name" placeholder="Название" />
          </label>
          <label className="grid gap-2 text-sm text-muted">UUID Remnawave
            <Input defaultValue={squad.remnawaveInternalSquadUuid ?? ""} name="remnawaveInternalSquadUuid" placeholder="UUID сквада" required />
          </label>
          <label className="grid gap-2 text-sm text-muted">Лимит пользователей
            <Input defaultValue={squad.memberLimit} min="1" name="memberLimit" type="number" required />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CheckField variant="switch" defaultChecked={squad.isActive} name="isActive">Активный сквад</CheckField>
          <PendingButton variant="ghost" disabled={deletePending}>Сохранить</PendingButton>
        </div>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <p className="text-sm text-muted">Занято {squad.userCount} из {squad.memberLimit} мест</p>
        <form action={deleteAction}>
          <input type="hidden" name="squadId" value={squad.id} />
          <ConfirmSubmit variant="danger" disabled={updatePending} label="Удалить сквад"
            message="Пользователи будут исключены из этого сквада и получат другой при синхронизации, если есть свободные места.">Удалить</ConfirmSubmit>
        </form>
      </div>
      <ActionMessage state={updateState} />
      <ActionMessage state={deleteState} />
    </div>
  );
}

export function SquadManager({ squads }: { squads: SquadItem[] }) {
  const [createState, createAction] = useActionState(createSquadAction, initialState);
  return (
    <div className="grid gap-4">
      <form action={createAction} className="grid gap-3 rounded-xl border border-line p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(6rem,.6fr)]">
          <label className="grid gap-2 text-sm text-muted">UUID сквада
            <Input name="remnawaveInternalSquadUuid" placeholder="UUID из Remnawave" required />
          </label>
          <label className="grid gap-2 text-sm text-muted">Название
            <Input name="name" placeholder="Название для админки" />
          </label>
          <label className="grid gap-2 text-sm text-muted">Лимит пользователей
            <Input min="1" name="memberLimit" required type="number" />
          </label>
        </div>
        <div><PendingButton>Добавить сквад</PendingButton></div>
        <ActionMessage state={createState} />
      </form>
      {squads.length ? squads.map((squad) => <SquadRow key={squad.id} squad={squad} />)
        : <EmptyState>Сквадов пока нет. Добавьте сквад из Remnawave.</EmptyState>}
    </div>
  );
}
