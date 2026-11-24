"use client";

import { useActionState, useEffect } from "react";
import { restartSiteAction, type SiteRestartActionState } from "@/app/actions";
import { Card } from "@/components/ui/card";
import { ConfirmSubmit } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/page";

const initialState: SiteRestartActionState = { status: "idle", message: "" };

export function SiteRestartCard() {
  const [state, action] = useActionState(restartSiteAction, initialState);
  useEffect(() => {
    if (state.status !== "success") return;
    const reloadTimer = window.setTimeout(() => window.location.reload(), 13_000);
    return () => window.clearTimeout(reloadTimer);
  }, [state.status]);

  return (
    <Card className="space-y-3">
      <SectionHeader title="Перезапуск сайта" description="Сайт будет недоступен во время перезапуска. Страница обновится автоматически." />
      <form action={action}>
        <ConfirmSubmit variant="danger" label="Перезапустить" message="Подтвердите перезапуск 1VPN.">Перезапустить сайт</ConfirmSubmit>
      </form>
      {state.message ? <Notice tone={state.status === "error" ? "danger" : "success"}>{state.message}</Notice> : null}
    </Card>
  );
}
