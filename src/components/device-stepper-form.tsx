"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";

export function DeviceStepperForm({ action, currentValue }: {
  action: (formData: FormData) => Promise<void>;
  currentValue: number;
}) {
  const [value, setValue] = useState(currentValue);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2.5">
      <input type="hidden" name="hwidDeviceLimit" value={String(value)} />
      <div className="inline-flex items-center gap-2 rounded-xl border border-line bg-background p-1.5">
        <IconButton label="Уменьшить количество устройств" disabled={value <= 1}
          onClick={() => setValue((previous) => Math.max(1, previous - 1))}><Minus size={18} aria-hidden="true" /></IconButton>
        <output aria-label="Лимит устройств" className="min-w-8 text-center text-xl font-semibold tabular-nums">{value}</output>
        <IconButton label="Увеличить количество устройств" disabled={value >= 100}
          onClick={() => setValue((previous) => Math.min(100, previous + 1))}><Plus size={18} aria-hidden="true" /></IconButton>
      </div>
      <PendingButton variant="ghost">Сохранить лимит</PendingButton>
    </form>
  );
}
