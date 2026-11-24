"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Notice } from "@/components/ui/feedback";
import { publicEnv } from "@/lib/public-env";

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, string>) => void;
  }
}

type TelegramLoginProps = {
  mode?: "login" | "link";
  onLinked?: () => void;
};

function telegramErrorMessage(error?: string | null) {
  if (error === "Telegram bot token is not configured.") return "Вход через Telegram пока недоступен.";
  if (error === "Telegram auth payload is expired.") return "Подтверждение истекло. Войдите через Telegram ещё раз.";
  if (error === "Telegram auth hash is invalid.") return "Не удалось проверить подтверждение Telegram. Попробуйте ещё раз.";
  return "Не удалось войти через Telegram. Попробуйте ещё раз.";
}

export function TelegramLogin({ mode = "login", onLinked }: TelegramLoginProps) {
  const router = useRouter();
  const botUsername = publicEnv.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!botUsername || !containerRef.current) {
      return;
    }

    window.onTelegramAuth = async (user) => {
      setError(null);
      setSuccess(null);

      if (mode === "link") {
        const response = await fetch("/api/telegram/link", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(user),
        });

        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(payload.error ?? "Не удалось привязать Telegram.");
          return;
        }

        setSuccess("Telegram привязан.");
        router.refresh();
        onLinked?.();
        return;
      }

      const result = await signIn("telegram", {
        ...user,
        redirect: false,
        callbackUrl: "/dashboard",
      }).catch(() => null);

      if (!result?.ok || result.error) {
        setError(telegramErrorMessage(result?.error));
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.onerror = () => setError("Не удалось загрузить вход через Telegram. Обновите страницу.");
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "999");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");

    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(script);

    return () => {
      script.onerror = null;
      delete window.onTelegramAuth;
    };
  }, [botUsername, mode, onLinked, router]);

  if (!botUsername) {
    return <Notice>Вход через Telegram сейчас недоступен.</Notice>;
  }

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="min-h-12" />
      {success ? <Notice tone="success">{success}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}
