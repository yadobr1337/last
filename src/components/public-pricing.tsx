import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { PUBLIC_BILLING_MONTH_DAYS } from "@/lib/site";
import { formatCurrency } from "@/lib/utils";

export function PublicPricing({ dailyPriceKopeks, trialDays, joinHref, joinLabel }: {
  dailyPriceKopeks: number; trialDays: number; joinHref: string; joinLabel: string;
}) {
  return (
    <div className="pricing-layout">
      <Card className="price-card">
        <h3>Оплата по дням</h3>
        <p className="price-number">{formatCurrency(dailyPriceKopeks, 2)}<span>в день за устройство</span></p>
        <p>Одно устройство на {PUBLIC_BILLING_MONTH_DAYS} дней обойдётся в {formatCurrency(dailyPriceKopeks * PUBLIC_BILLING_MONTH_DAYS, 2)}.</p>
        <ButtonLink href={joinHref}>{joinLabel}</ButtonLink>
      </Card>
      <Card className="price-card">
        <h3>Пробный период</h3>
        <p className="price-number">{trialDays}<span>дн.</span></p>
        <p>Привяжите Telegram через бота, чтобы один раз попробовать сервис бесплатно.</p>
      </Card>
    </div>
  );
}
