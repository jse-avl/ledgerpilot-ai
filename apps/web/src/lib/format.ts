import { format, money } from "@ledgerpilot/core";
import { intlLocale, type Locale } from "./i18n";

/** Money is always minor units + currency; formatting is the only place that divides. */
export function formatMinor(amountMinor: number, currency: string, locale: Locale): string {
  return format(money(amountMinor, currency), intlLocale(locale));
}

export function formatDate(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatDateTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

/** Quantities are stored with three decimals to avoid floats. */
export function formatQuantity(quantityMilli: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(quantityMilli / 1000);
}

export function shortHash(hash: string | null, length = 12): string {
  if (!hash) return "—";
  return `${hash.slice(0, length)}…`;
}
