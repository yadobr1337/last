"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyButton({ value }: { value: string }) {
  const [status, setStatus] = useState<"ready" | "copied" | "failed">("ready");
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
      timer.current = window.setTimeout(() => setStatus("ready"), 1800);
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="inline-grid gap-2">
      <Button type="button" variant="ghost" onClick={copy}>
        {status === "copied" ? <Check size={17} className="text-emerald-300" aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
        <span aria-live="polite">{status === "copied" ? "Скопировано" : "Копировать"}</span>
      </Button>
      {status === "failed" && <span role="alert" className="text-sm text-red-300">Выделите ссылку и скопируйте её вручную.</span>}
    </div>
  );
}
