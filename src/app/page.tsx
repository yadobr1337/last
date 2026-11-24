import Link from "next/link";
import { Cable, Globe2, Laptop, Plus, ShieldCheck, Wallet } from "lucide-react";
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
import { formatCurrency } from "@/lib/utils";

const sections = [
  { href: "#benefits", label: "Возможности" },
  { href: "#pricing", label: "Тариф" },
  { href: "#faq", label: "Вопросы" },
];

const benefits = [
  { title: "Зашифрованное подключение", description: "Подключайтесь через VPN-туннель. Доступ, баланс и ссылка подписки собраны в личном кабинете.", icon: ShieldCheck },
  { title: "Быстрый старт", description: "Получите ссылку подписки и добавьте её в совместимое VPN-приложение.", icon: Cable },
  { title: "Доступ к сети", description: "Открывайте повседневные сайты, сервисы и приложения через VPN.", icon: Globe2 },
  { title: "Ваши устройства", description: "Меняйте лимит и удаляйте устройства, которыми больше не пользуетесь.", icon: Laptop },
  { title: "Гибкое пополнение", description: "Выбирайте сумму пополнения и следите за остатком в кабинете.", icon: Wallet },
];

export default async function HomePage() {
  const [session, settings] = await Promise.all([getAuthSession(), getSettings()]);
  const isAdmin = session?.user.role === "ADMIN";
  if (settings.maintenanceEnabled && !isAdmin) {
    return <MaintenanceScreen message={settings.maintenanceMessage}
      showLogin={!session?.user} showLogout={Boolean(session?.user)} />;
  }

  const joinHref = session?.user ? "/dashboard" : "/register";
  const joinLabel = session?.user ? "Открыть кабинет" : "Подключиться";
  const mobileLinks = [...sections, ...(isAdmin ? [{ href: "/admin", label: "Админка" }] : []),
    ...(!session?.user ? [{ href: "/login", label: "Войти" }] : []), { href: joinHref, label: joinLabel }];
  const offerUrl = env.NEXT_PUBLIC_OFFER_URL ?? DEFAULT_OFFER_URL;
  const privacyUrl = env.NEXT_PUBLIC_PRIVACY_URL ?? DEFAULT_PRIVACY_URL;
  const supportUrl = settings.supportTelegramUrl ?? env.NEXT_PUBLIC_SUPPORT_TELEGRAM_URL ?? DEFAULT_SUPPORT_TELEGRAM_URL;
  const questions = [
    { question: "Как подключить VPN?", answer: "Войдите в личный кабинет и пополните баланс. Когда подписка будет готова, откройте ссылку или скопируйте её в приложение, которое поддерживает ссылки подписки." },
    { question: "Как рассчитывается стоимость?", answer: "Оплата посуточная. Расход зависит от цены за день и выбранного вами лимита устройств. Текущий баланс и примерный остаток времени видны в кабинете." },
    { question: "Как получить пробный доступ?", answer: "Создайте аккаунт и подтвердите Telegram через бота. После этого в кабинете можно один раз активировать пробный период." },
    { question: "Что произойдёт, когда баланс закончится?", answer: "VPN-доступ приостановится. Пополните баланс в течение " + settings.deletionGraceHours + " ч, чтобы сохранить подписку." },
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
            <div className="hero-kicker"><ShieldCheck size={18} aria-hidden="true" /> VPN с посуточной оплатой</div>
            <h1>Твой интернет. <span>Твои правила.</span></h1>
            <p>Быстрое и удобное подключение к VPN с управлением подпиской в одном личном кабинете.</p>
            <div className="hero-actions">
              <ButtonLink href={joinHref} prefetch={false} size="lg">{joinLabel}</ButtonLink>
              <a href="#benefits" className="ui-button ui-button-ghost ui-button-lg">Узнать больше</a>
            </div>
            <div className="hero-price">{formatCurrency(settings.pricePerDayKopeks)} в день за устройство</div>
          </div>
          <div className="hero-art ui-reveal ui-delay">
            <OneVpnNetworkLogo eager />
          </div>
        </section>

        <section id="benefits" className="site-section">
          <div className="obsidian-wrap">
            <div className="site-section-heading">
              <h2>VPN под вашим контролем</h2>
              <p>Подключение, подписка и устройства в одном месте.</p>
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
              <h2>Прозрачный тариф</h2>
              <p>Стоимость зависит от срока использования и лимита устройств.</p>
            </div>
            <PublicPricing dailyPriceKopeks={settings.pricePerDayKopeks} trialDays={settings.trialDays}
              joinHref={joinHref} joinLabel={joinLabel} />
          </div>
        </section>

        <section id="faq" className="site-section">
          <div className="obsidian-wrap faq-grid">
            <div className="site-section-heading">
              <h2>Частые вопросы</h2>
              <p>Как начать и управлять подпиской.</p>
            </div>
            <div>
              {questions.map(({ question, answer }) => (
                <details className="faq-item" key={question}>
                  <summary>{question}<Plus size={19} aria-hidden="true" /></summary>
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
            <a href={privacyUrl} target="_blank" rel="noreferrer">Конфиденциальность</a>
            <a href={supportUrl} target="_blank" rel="noreferrer">Поддержка в Telegram</a>
            {env.SUPPORT_EMAIL && <a href={"mailto:" + env.SUPPORT_EMAIL}>{env.SUPPORT_EMAIL}</a>}
          </nav>
        </div>
      </footer>
    </>
  );
}
