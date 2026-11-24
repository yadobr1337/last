"use client";

import { useActionState } from "react";
import { refreshRemnawaveStatusAction } from "@/app/actions";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page";
import { PendingButton } from "@/components/ui/pending-button";
import type { RemnawaveConnectionStatus } from "@/lib/remnawave";

const details = {
  connected: { label: "Панель доступна", tone: "success" },
  error: { label: "Не удалось подключиться", tone: "danger" },
  not_configured: { label: "Не настроено", tone: "neutral" },
} as const;

function formatUptime(seconds: number | null) {
  if (seconds === null) {
    return "—";
  }

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return days > 0 ? `${days} д. ${hours} ч.` : `${hours} ч.`;
}

function formatCheckedAt(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}


export function RemnawaveStatusCard({ initialStatus }: { initialStatus: RemnawaveConnectionStatus }) {
  const [status, refreshAction] = useActionState(refreshRemnawaveStatusAction, initialStatus);
  const { label, tone } = details[status.state];
  const metrics = [
    { label: "Задержка", value: status.latencyMs === null ? "—" : status.latencyMs + " мс" },
    { label: "Инстансы", value: status.instanceCount ?? "—" },
    { label: "Время работы", value: formatUptime(status.uptimeSeconds) },
    { label: "Проверено", value: formatCheckedAt(status.checkedAt) },
  ];
  return (
    <Card className="space-y-4">
      <SectionHeader title="Remnawave" description="Связь с VPN-панелью.">
        <form action={refreshAction}><PendingButton variant="ghost">Проверить подключение</PendingButton></form>
      </SectionHeader>
      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <StatusBadge tone={tone}>{label}</StatusBadge>
        <span className="break-all text-sm text-muted">{status.baseUrl ?? "URL панели не указан"}</span>
      </div>
      <p className="break-words text-sm text-muted">{status.message}</p>
      <dl className="grid grid-cols-2 gap-3 border-t border-line pt-4 lg:grid-cols-4">
        {metrics.map((metric) => <div key={metric.label}><dt className="text-sm text-muted">{metric.label}</dt>
          <dd className="mt-1 font-semibold tabular-nums">{metric.value}</dd></div>)}
      </dl>
    </Card>
  );
}
