import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth/auth-frame";
import { RegisterForm } from "@/components/auth/register-form";
import { TelegramLogin } from "@/components/auth/telegram-login";
import { MaintenanceScreen } from "@/components/maintenance-screen";
import { getAuthSession } from "@/lib/auth";
import { getCaptchaSiteKey } from "@/lib/captcha";
import { getSettings } from "@/lib/settings";

export default async function RegisterPage() {
  const [session, settings] = await Promise.all([getAuthSession(), getSettings()]);
  if (session?.user) redirect("/dashboard");
  if (settings.maintenanceEnabled) return <MaintenanceScreen message={settings.maintenanceMessage} />;

  return (
    <AuthFrame title="Регистрация" description="Зарегистрируйтесь по почте или войдите через Telegram.">
      <RegisterForm captchaEnabled={settings.captchaEnabled} captchaSiteKey={settings.captchaEnabled ? getCaptchaSiteKey() : undefined} />
      <div className="my-6 flex items-center gap-3 text-sm text-muted">
        <span className="h-px flex-1 bg-line" /> Telegram <span className="h-px flex-1 bg-line" />
      </div>
      <TelegramLogin mode="login" />
      <p className="mt-3 text-sm text-muted">После входа запустите бота, чтобы открыть пробный доступ.</p>
    </AuthFrame>
  );
}
