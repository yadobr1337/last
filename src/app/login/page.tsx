import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth/auth-frame";
import { LoginForm } from "@/components/auth/login-form";
import { getAuthSession } from "@/lib/auth";

export default async function LoginPage() {
  const session = await getAuthSession();
  if (session?.user) redirect("/dashboard");

  return (
    <AuthFrame title="Войти в 1VPN" description="Используйте email и пароль или войдите через Telegram.">
      <LoginForm />
    </AuthFrame>
  );
}
