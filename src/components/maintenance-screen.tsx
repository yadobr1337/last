import { Wrench } from "lucide-react";
import { Brand } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LogoutButton } from "@/components/logout-button";

export function MaintenanceScreen({ message, showLogin = true, showLogout = false }: {
  message?: string | null;
  showLogin?: boolean;
  showLogout?: boolean;
}) {
  return (
    <div className="auth-page">
      <header className="obsidian-wrap auth-header"><Brand /></header>
      <main className="obsidian-wrap maintenance-page">
        <Card className="maintenance-card ui-reveal">
          <div className="benefit-icon"><Wrench size={22} aria-hidden="true" /></div>
          <h1 className="mt-5 text-3xl font-bold tracking-tight">Технические работы</h1>
          <p className="mt-3 text-muted leading-relaxed">
            {message?.trim() || "Обновляем сайт 1VPN. Личный кабинет пока недоступен. Попробуйте зайти чуть позже."}
          </p>
          {(showLogin || showLogout) && <div className="mt-6 flex flex-wrap gap-2">
            {showLogin && <ButtonLink href="/login" variant="ghost">Вход администратора</ButtonLink>}
            {showLogout && <LogoutButton />}
          </div>}
        </Card>
      </main>
    </div>
  );
}
