import type { ReactNode } from "react";
import Link from "next/link";
import {
  Activity, Bell, Cable, CircleUserRound, ClipboardList, House, LayoutDashboard,
  Server, Settings, ShieldCheck, Smartphone, Users, Wallet,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { LogoutButton } from "@/components/logout-button";
import { MobileNavigation } from "@/components/mobile-navigation";

type ConsoleArea = "dashboard" | "account" | "admin";

export function ConsoleShell({ area, isAdmin, children }: {
  area: ConsoleArea; isAdmin: boolean; children: ReactNode;
}) {
  const pages = [
    { href: "/dashboard", label: "Кабинет", icon: LayoutDashboard, current: area === "dashboard" },
    { href: "/dashboard/account", label: "Аккаунт", icon: CircleUserRound, current: area === "account" },
    ...(isAdmin ? [{ href: "/admin", label: "Админка", icon: ShieldCheck, current: area === "admin" }] : []),
  ];
  const sections = area === "admin" ? [
    { href: "#overview", label: "Обзор", icon: Activity },
    { href: "#users", label: "Пользователи", icon: Users },
    { href: "#finance", label: "Финансы и тарифы", icon: Wallet },
    { href: "#vpn", label: "Remnawave и сквады", icon: Cable },
    { href: "#nodes", label: "Серверы", icon: Server },
    { href: "#notifications", label: "Уведомления", icon: Bell },
    { href: "#journal", label: "Журнал событий", icon: ClipboardList },
    { href: "#maintenance", label: "Обслуживание", icon: Settings },
  ] : area === "dashboard" ? [
    { href: "#connection", label: "Подключение", icon: Cable },
    { href: "#devices", label: "Устройства", icon: Smartphone },
    { href: "#support", label: "Поддержка", icon: Bell },
  ] : [
    { href: "#email", label: "Электронная почта", icon: CircleUserRound },
    { href: "#password", label: "Пароль", icon: ShieldCheck },
    { href: "#telegram", label: "Telegram", icon: Bell },
  ];

  return (
    <div className="console-shell">
      <aside className="console-sidebar">
        <Brand />
        <nav className="console-sidebar-nav" aria-label="Рабочая область">
          {pages.map(({ href, label, current, icon: Icon }) => (
            <Link key={href} href={href} aria-current={current ? "page" : undefined}>
              <Icon aria-hidden="true" />{label}
            </Link>
          ))}
        </nav>
        <nav className="console-sidebar-nav border-t border-line pt-3" aria-label="Разделы страницы">
          {sections.map(({ href, label, icon: Icon }) => (
            <a key={href} href={href}><Icon aria-hidden="true" />{label}</a>
          ))}
        </nav>
        <div className="console-sidebar-footer">
          <nav className="console-sidebar-nav" aria-label="Публичный сайт">
            <Link href="/"><House aria-hidden="true" />Главная</Link>
          </nav>
          <LogoutButton className="w-full" />
        </div>
      </aside>
      <header className="console-mobile">
        <Brand />
        <MobileNavigation links={[...pages.map(({ href, label, current }) => ({ href, label, current })),
          ...sections.map(({ href, label }) => ({ href, label })), { href: "/", label: "Главная" }]}>
          <LogoutButton className="w-full" />
        </MobileNavigation>
      </header>
      <nav className="console-quick-nav" aria-label="Быстрый переход">
        {pages.map(({ href, label, current }) => <Link key={href} href={href}
          aria-current={current ? "page" : undefined}>{label}</Link>)}
      </nav>
      <main className="console-content ui-reveal">
        <div className="console-breadcrumb">{area === "admin" ? "Администрирование" : "Личный кабинет"}</div>
        {children}
      </main>
    </div>
  );
}
