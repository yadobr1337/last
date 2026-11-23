export const MAX_BALANCE_KOPEKS = 2_147_483_647;

export function parseRubleAmount(value: string): number {
  const match = /^(-?)(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("Укажите сумму с точностью до копейки.");

  const kopeks = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  if (kopeks > MAX_BALANCE_KOPEKS) throw new Error("Сумма превышает допустимый лимит.");

  return match[1] ? -kopeks : kopeks;
}

export function canUseDemoPayments() {
  return process.env.NODE_ENV === "development" && process.env.PAYMENTS_AUTO_APPROVE === "true";
}
