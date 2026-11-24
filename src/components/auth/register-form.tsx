"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { HCaptchaWidget } from "@/components/auth/hcaptcha-widget";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

export function RegisterForm({ captchaEnabled }: { captchaEnabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const [pending, startTransition] = useTransition();
  const captchaRequired = captchaEnabled;
  const resetCaptcha = useCallback(() => {
    setCaptchaToken("");
    setCaptchaResetSignal((value) => value + 1);
  }, []);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setMessage(null);
        const form = event.currentTarget;

        if (captchaRequired && !captchaToken) {
          setError("Пройдите CAPTCHA перед регистрацией.");
          return;
        }

        startTransition(async () => {
          const formData = new FormData(form);
          const email = String(formData.get("email") ?? "");
          const password = String(formData.get("password") ?? "");

          const response = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email,
              password,
              captchaToken,
            }),
          });

          const payload = (await response.json()) as { error?: string; emailCodeSent?: boolean };
          if (!response.ok) {
            setError(payload.error ?? "Не удалось создать аккаунт.");
            resetCaptcha();
            return;
          }

          const result = await signIn("credentials", {
            email,
            password,
            redirect: false,
            callbackUrl: "/dashboard",
          });

          if (!result?.ok || result.error) {
            setError("Аккаунт создан. Войдите с указанным email и паролем.");
            return;
          }

          setMessage(
            payload.emailCodeSent
              ? "Аккаунт создан. Код подтверждения email уже отправлен."
              : "Аккаунт создан. Подтверждение email можно будет выполнить позже.",
          );
          router.replace("/dashboard");
          router.refresh();
        });
      }}
    >
      <div className="space-y-2">
        <label htmlFor="register-email" className="text-sm text-muted">Email</label>
        <Input id="register-email" name="email" type="email" autoComplete="email" placeholder="you@domain.com" required />
      </div>
      <div className="space-y-2">
        <label htmlFor="register-password" className="text-sm text-muted">Пароль</label>
        <PasswordInput id="register-password" name="password" autoComplete="new-password" placeholder="Минимум 8 символов" minLength={8} required />
      </div>

      <HCaptchaWidget
        enabled={captchaEnabled}
        onVerify={setCaptchaToken}
        onReset={resetCaptcha}
        resetSignal={captchaResetSignal}
      />

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button className="w-full" disabled={pending} aria-busy={pending}>
        {pending ? "Создание..." : "Создать аккаунт"}
      </Button>

      <p className="text-sm text-zinc-400">
        Уже есть аккаунт?{" "}
        <Link href="/login" className="text-cyan-300 transition hover:text-cyan-200">
          Войти
        </Link>
      </p>
    </form>
  );
}
