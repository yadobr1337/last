import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

type PublicPricingProps = {
  monthlyPriceKopeks: number;
  trialDays: number;
};

export function PublicPricing({
  monthlyPriceKopeks,
  trialDays,
}: PublicPricingProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
      <Card className="hero-glow rounded-[24px] p-4 sm:rounded-[28px] sm:p-6">
        <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500 sm:text-xs sm:tracking-[0.3em]">
          Цена за месяц
        </p>
        <p
          className="mt-2.5 text-[2rem] font-bold leading-none text-white sm:mt-3 sm:text-3xl"
        >
          {formatCurrency(monthlyPriceKopeks)}
        </p>
      </Card>
      <Card className="rounded-[24px] p-4 sm:rounded-[28px] sm:p-6">
        <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500 sm:text-xs sm:tracking-[0.3em]">
          Пробный период
        </p>
        <p
          className="mt-2.5 text-[2rem] font-bold leading-none text-white sm:mt-3 sm:text-3xl"
        >
          {trialDays} дн.
        </p>
      </Card>
    </div>
  );
}
