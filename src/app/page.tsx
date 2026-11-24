import Link from "next/link";
import { Cable, Globe2, Laptop, Minus, Plus, ShieldCheck, Wallet } from "lucide-react";
import { Brand } from "@/components/brand";
import { MobileNavigation } from "@/components/mobile-navigation";
import { MaintenanceScreen } from "@/components/maintenance-screen";
import { OneVpnNetworkLogo } from "@/components/one-vpn-network-logo";
import { PublicPricing } from "@/components/public-pricing";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAuthSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { DEFAULT_OFFER_URL, DEFAULT_PRIVACY_URL, DEFAULT_SUPPORT_TELEGRAM_URL } from "@/lib/site";
import { formatCurrency, formatDuration } from "@/lib/utils";

const sections = [
  { href: "#benefits", label: "Возможности" },
  { href: "#pricing", label: "Тариф" },
  { href: "#faq", label: "Вопросы" },
];

const benefits = [
  { title: "Всё под рукой", description: "Баланс, ссылка для подключения и настройки устройств всегда доступны в личном кабинете.", icon: ShieldCheck },
  { title: "Простое подключение", description: "Получите ссылку подписки и добавьте её в подходящее VPN-приложение.", icon: Cable },
  { title: "Для сайтов и приложений", description: "Пользуйтесь привычными сайтами и приложениями через VPN.", icon: Globe2 },
  { title: "Несколько устройств", description: "Выбирайте нужное количество подключений и убирайте устройства, которыми больше не пользуетесь.", icon: Laptop },
  { title: "Оплата по дням", description: "Стоимость зависит от количества устройств. Расходы и остаток баланса видны в кабинете.", icon: Wallet },
];

export default async function HomePage() {
  const [session, settings] = await Promise.all([getAuthSession(), getSettings()]);
  const isAdmin = session?.user.role === "ADMIN";
  if (settings.maintenanceEnabled && !isAdmin) {
    return <MaintenanceScreen message={settings.maintenanceMessage}
      showLogin={!session?.user} showLogout={Boolean(session?.user)} />;
  }

  const joinHref = session?.user ? "/dashboard" : "/register";
  const joinLabel = session?.user ? "Открыть кабинет" : "Подключить VPN";
  const mobileLinks = [...sections, ...(isAdmin ? [{ href: "/admin", label: "Админка" }] : []),
    ...(!session?.user ? [{ href: "/login", label: "Войти" }] : []), { href: joinHref, label: joinLabel }];
  const offerUrl = env.NEXT_PUBLIC_OFFER_URL ?? DEFAULT_OFFER_URL;
  const privacyUrl = env.NEXT_PUBLIC_PRIVACY_URL ?? DEFAULT_PRIVACY_URL;
  const supportUrl = settings.supportTelegramUrl ?? env.NEXT_PUBLIC_SUPPORT_TELEGRAM_URL ?? DEFAULT_SUPPORT_TELEGRAM_URL;
  const dailyPrice = formatCurrency(settings.pricePerDayKopeks, 2);
  const gracePeriod = formatDuration(settings.deletionGraceHours, "hour");
  const questions = [
    { question: "Как подключить VPN?", answer: "Создайте аккаунт и пополните баланс. Ссылка для подключения появится в личном кабинете. Добавьте её в VPN-приложение и включите подключение." },
    { question: "Сколько это стоит?", answer: `От ${dailyPrice} в день за устройство. Сумма зависит от количества устройств. Стоимость и остаток баланса видны в личном кабинете.` },
    { question: "Можно попробовать бесплатно?", answer: `Да, пробный доступ на ${formatDuration(settings.trialDays, "day")} можно включить один раз. Для этого привяжите Telegram через нашего бота.` },
    { question: "Что будет, если закончатся деньги?", answer: `VPN временно перестанет работать. Пополните баланс, чтобы подключиться снова. После приостановки есть ${gracePeriod} на пополнение, чтобы сохранить текущую ссылку.` },
  ];

  return (
    <>
      <header className="site-header">
        <div className="obsidian-wrap site-header-inner">
          <Brand />
          <nav aria-label="Разделы сайта" className="site-links">
            {sections.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
          </nav>
          <div className="site-actions">
            {isAdmin && <Link href="/admin" className="site-login-link">Админка</Link>}
            {!session?.user && <Link href="/login" className="site-login-link" prefetch={false}>Войти</Link>}
            <ButtonLink href={joinHref} prefetch={false} size="sm">{joinLabel}</ButtonLink>
          </div>
          <MobileNavigation links={mobileLinks} />
        </div>
      </header>

      <main id="main-content">
        <section className="obsidian-wrap hero">
          <div className="hero-copy ui-reveal">
            <div className="hero-kicker"><ShieldCheck size={18} aria-hidden="true" /> 1VPN · Оплата по дням</div>
            <h1>Твой интернет. <span>Твои правила.</span></h1>
            <p>Подключайтесь по ссылке, выбирайте количество устройств и пополняйте баланс, когда удобно.</p>
            <div className="hero-actions">
              <ButtonLink href={joinHref} prefetch={false} size="lg">{joinLabel}</ButtonLink>
              <a href="#benefits" className="ui-button ui-button-ghost ui-button-lg">Как это работает</a>
            </div>
            <div className="hero-price">От {dailyPrice} в день за устройство</div>
          </div>
          <div className="hero-art ui-reveal ui-delay">
            <OneVpnNetworkLogo eager />
          </div>
        </section>

        <section id="benefits" className="site-section">
          <div className="obsidian-wrap">
            <div className="site-section-heading">
              <h2>Всё необходимое — в одном месте</h2>
              <p>Подключение, оплата и управление устройствами без лишних сложностей.</p>
            </div>
            <div className="benefits">
              {benefits.map(({ title, description, icon: Icon }) => (
                <Card className="benefit" key={title}>
                  <div className="benefit-icon"><Icon size={22} aria-hidden="true" /></div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="site-section">
          <div className="obsidian-wrap">
            <div className="site-section-heading">
              <h2>Сколько стоит</h2>
              <p>Выберите количество устройств. Оплата списывается с баланса.</p>
            </div>
            <PublicPricing dailyPriceKopeks={settings.pricePerDayKopeks} trialDays={settings.trialDays}
              joinHref={joinHref} joinLabel={joinLabel} />
          </div>
        </section>

        <section id="faq" className="site-section">
          <div className="obsidian-wrap faq-grid">
            <div className="site-section-heading">
              <h2>Частые вопросы</h2>
            </div>
            <div>
              {questions.map(({ question, answer }) => (
                <details className="faq-item" key={question}>
                  <summary>{question}
                    <Plus className="faq-open-icon" size={19} aria-hidden="true" />
                    <Minus className="faq-close-icon" size={19} aria-hidden="true" />
                  </summary>
                  <p className="faq-answer">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="obsidian-wrap site-footer-inner">
          <Brand />
          <nav aria-label="Контакты и документы">
            <a href={offerUrl} target="_blank" rel="noreferrer">Публичная оферта</a>
            <a href={privacyUrl} target="_blank" rel="noreferrer">Политика конфиденциальности</a>
            <a href={supportUrl} target="_blank" rel="noreferrer">Написать в Telegram</a>
            {env.SUPPORT_EMAIL && <a href={"mailto:" + env.SUPPORT_EMAIL}>{env.SUPPORT_EMAIL}</a>}
          </nav>
        </div>
      </footer>
    </>
  );
}
