"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { SmartCaptchaWidget } from "@/components/auth/smart-captcha-widget";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

export function RegisterForm({ captchaEnabled, captchaSiteKey }: { captchaEnabled: boolean; captchaSiteKey?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const [pending, startTransition] = useTransition();
  const captchaUnavailable = captchaEnabled && !captchaSiteKey;
  function resetCaptcha() {
    setCaptchaToken("");
    setCaptchaResetSignal((value) => value + 1);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setMessage(null);
        const form = event.currentTarget;

        if (captchaEnabled && !captchaToken) {
          setError(captchaUnavailable ? "Проверка регистрации пока недоступна." : "Пройдите проверку SmartCaptcha.");
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
          }).catch(() => null);

          const payload = (await response?.json().catch(() => null)) as { ok?: boolean; error?: string; emailCodeSent?: boolean } | null | undefined;
          if (!response?.ok || !payload?.ok) {
            setError(response?.status === 409 ? "Эта почта уже зарегистрирована. Войдите в аккаунт."
              : payload?.error ?? "Не удалось зарегистрироваться. Попробуйте ещё раз.");
            resetCaptcha();
            return;
          }

          const result = await signIn("credentials", {
            email,
            password,
            redirect: false,
            callbackUrl: "/dashboard",
          }).catch(() => null);

          if (!result?.ok || result.error) {
            setError("Аккаунт создан. Войдите с указанным email и паролем.");
            return;
          }

          setMessage(
            payload.emailCodeSent
              ? "Аккаунт создан. Код подтверждения отправлен на почту."
              : "Аккаунт создан. Почту можно подтвердить позже в настройках.",
          );
          router.replace("/dashboard");
          router.refresh();
        });
      }}
    >
      <div className="space-y-2">
        <label htmlFor="register-email" className="text-sm text-muted">Электронная почта</label>
        <Input id="register-email" name="email" type="email" autoComplete="email" placeholder="you@domain.com" required />
      </div>
      <div className="space-y-2">
        <label htmlFor="register-password" className="text-sm text-muted">Пароль</label>
        <PasswordInput id="register-password" name="password" autoComplete="new-password" placeholder="Минимум 8 символов" minLength={8} required />
      </div>

      {captchaSiteKey ? <SmartCaptchaWidget siteKey={captchaSiteKey} onVerify={setCaptchaToken} resetSignal={captchaResetSignal} /> : null}
      {captchaUnavailable ? <Notice tone="danger">Проверка регистрации временно недоступна.</Notice> : null}

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button className="w-full" disabled={pending || captchaUnavailable} aria-busy={pending}>
        {pending ? "Регистрируем…" : "Зарегистрироваться"}
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
