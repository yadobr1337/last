"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { TelegramLogin } from "@/components/auth/telegram-login";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

export function LoginForm() {
  const router = useRouter();
  const [resetMode, setResetMode] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-6">
      {!resetMode ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setMessage(null);
            const form = event.currentTarget;

            startTransition(async () => {
              const formData = new FormData(form);
              const result = await signIn("credentials", {
                email: String(formData.get("email") ?? ""),
                password: String(formData.get("password") ?? ""),
                redirect: false,
                callbackUrl: "/dashboard",
              });

              if (!result?.ok || result.error) {
                setError("Неверный email или пароль.");
                return;
              }

              router.replace("/dashboard");
              router.refresh();
            });
          }}
        >
          <div className="space-y-2">
            <label htmlFor="login-email" className="text-sm text-muted">Email</label>
            <Input id="login-email" name="email" type="email" autoComplete="username" placeholder="you@domain.com" required />
          </div>
          <div className="space-y-2">
            <label htmlFor="login-password" className="text-sm text-muted">Пароль</label>
            <PasswordInput id="login-password" name="password" autoComplete="current-password" placeholder="••••••••" required />
          </div>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <button
            type="button"
            onClick={() => {
              setResetMode(true);
              setError(null);
              setMessage(null);
            }}
            className="text-sm text-cyan-300 transition hover:text-cyan-200"
          >
            Забыли пароль?
          </button>
          <Button className="w-full" disabled={pending} aria-busy={pending}>
            {pending ? <><span className="ui-spinner" aria-hidden="true" /> Входим…</> : "Войти"}
          </Button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setMessage(null);
            const form = event.currentTarget;

            startTransition(async () => {
              const formData = new FormData(form);
              const email = String(formData.get("email") ?? "");
              const code = String(formData.get("code") ?? "");
              const password = String(formData.get("password") ?? "");

              const response = await fetch("/api/auth/password-reset/confirm", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ email, code, password }),
              });

              const payload = (await response.json()) as { error?: string };
              if (!response.ok) {
                setError(payload.error ?? "Не удалось обновить пароль.");
                return;
              }

              setMessage("Пароль обновлен. Теперь можно войти с новым паролем.");
              form.reset();
            });
          }}
        >
          <div className="space-y-2">
            <label htmlFor="reset-email" className="text-sm text-muted">Email</label>
            <Input id="reset-email" name="email" type="email" autoComplete="email" placeholder="you@domain.com" required />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <label htmlFor="reset-code" className="text-sm text-muted">Код из письма</label>
              <Input id="reset-code" name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required />
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={(event) => {
                const form = event.currentTarget.form;
                if (!form) return;

                const formData = new FormData(form);
                const email = String(formData.get("email") ?? "").trim();
                if (!email) {
                  setError("Введите email, чтобы получить код.");
                  return;
                }

                setError(null);
                setMessage(null);

                startTransition(async () => {
                  const response = await fetch("/api/auth/password-reset/request", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ email }),
                  });

                  if (!response.ok) {
                    setError("Не удалось отправить код. Попробуйте позже.");
                    return;
                  }

                  setMessage("Если email подтверждён, на него придёт письмо с кодом.");
                });
              }}
              className="sm:self-end"
            >
              Получить код
            </Button>
          </div>
          <div className="space-y-2">
            <label htmlFor="reset-password" className="text-sm text-muted">Новый пароль</label>
            <PasswordInput id="reset-password" name="password" autoComplete="new-password" minLength={8} placeholder="Новый пароль" required />
          </div>
          {message ? <Notice tone="success">{message}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <button
            type="button"
            onClick={() => {
              setResetMode(false);
              setError(null);
              setMessage(null);
            }}
            className="text-sm text-zinc-400 transition hover:text-white"
          >
            Назад ко входу
          </button>
          <Button className="w-full" disabled={pending}>
            {pending ? "Сохранение..." : "Сбросить пароль"}
          </Button>
        </form>
      )}

      <div className="flex items-center gap-3 text-sm text-muted">
        <span className="h-px flex-1 bg-line" />
        Telegram
        <span className="h-px flex-1 bg-line" />
      </div>

      <TelegramLogin mode="login" />

      <p className="text-sm text-zinc-400">
        Нет аккаунта?{" "}
        <Link href="/register" className="text-cyan-300 transition hover:text-cyan-200">
          Зарегистрироваться
        </Link>
      </p>
    </div>
  );
}
