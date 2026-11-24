import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(valueKopeks: number, fractionDigits: 0 | 2 = 0) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(fractionDigits === 0 ? Math.round(valueKopeks / 100) : valueKopeks / 100);
}

export function formatDays(days: number, withUnit = false) {
  const wholeDays = Math.max(0, Math.floor(days));
  if (withUnit) return formatDuration(wholeDays, "day");
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(wholeDays);
}

export function formatDuration(value: number, unit: "day" | "hour") {
  return new Intl.NumberFormat("ru-RU", { style: "unit", unit, unitDisplay: "long" }).format(value);
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function absoluteUrl(path: string) {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return new URL(path, base).toString();
}
