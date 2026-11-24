"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type LinkResponse = {
  error?: string;
  url?: string;
};

export function TelegramBotLink() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function startLinking() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/telegram/link/start", {
        method: "POST",
      });
      const payload = (await response.json()) as LinkResponse;

      if (!response.ok || !payload.url) {
        setError(response.status === 503 ? "Бот Telegram сейчас недоступен. Попробуйте позже."
          : response.status === 401 ? "Войдите в аккаунт, чтобы привязать Telegram."
            : payload.error ?? "Не удалось открыть бота. Попробуйте ещё раз.");
        return;
      }

      window.location.href = payload.url;
    } catch {
      setError("Не удалось открыть Telegram. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={startLinking} disabled={pending}>
          {pending ? "Открываем Telegram…" : "Открыть бота"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.refresh()}>
          Проверить привязку
        </Button>
      </div>
      <p className="text-sm leading-6 text-zinc-400">
        Откройте бота и нажмите Start. После подтверждения станут доступны пробный период и уведомления.
        Ссылка действует 15 минут.
      </p>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
