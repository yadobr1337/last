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
        <h3>Доступ по балансу</h3>
        <p className="price-number">{formatCurrency(dailyPriceKopeks)}<span>в сутки</span></p>
        <p>{formatCurrency(dailyPriceKopeks * PUBLIC_BILLING_MONTH_DAYS)} за {PUBLIC_BILLING_MONTH_DAYS} дней при одном устройстве.</p>
        <ButtonLink href={joinHref}>{joinLabel}</ButtonLink>
      </Card>
      <Card className="price-card">
        <h3>Пробный период</h3>
        <p className="price-number">{trialDays}<span>дн.</span></p>
        <p>Активируется один раз после подтверждения Telegram через бота.</p>
      </Card>
    </div>
  );
}
