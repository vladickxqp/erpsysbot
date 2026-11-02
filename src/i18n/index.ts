/**
 * Six languages (de, en, ru, uk, kk, es); another one is a new file in
 * ./messages with the same keys — TypeScript refuses a missing one.
 */
import de, { type Messages } from "./messages/de";
import en from "./messages/en";
import es from "./messages/es";
import kk from "./messages/kk";
import ru from "./messages/ru";
import uk from "./messages/uk";

export const LOCALES = ["de", "en", "ru", "uk", "kk", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "de";
export const LOCALE_COOKIE = "erp_locale";

export const MESSAGES: Record<Locale, Messages> = { de, en, ru, uk, kk, es };
export type { Messages };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** A text by its dotted key ("clients.title"), with {placeholders} filled. */
export function translator(messages: Messages) {
  return function t(key: string, vars?: Record<string, string | number>): string {
    let node: unknown = messages;
    for (const part of key.split(".")) {
      node = node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
    }
    const text = typeof node === "string" ? node : key;
    return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text;
  };
}

export type T = ReturnType<typeof translator>;

/** The best of our languages for an Accept-Language header. */
export function fromAcceptLanguage(header: string | null | undefined): Locale {
  for (const part of (header ?? "").split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}

/**
 * The company's country and currency: they decide how amounts and dates are
 * written. Its own tax rates ride along for the forms (null: the country's).
 */
export type Region = { country: string; currency: string; taxRates?: number[] | null };
export const DEFAULT_REGION: Region = { country: "DE", currency: "EUR" };

/** The usual words for "piece" and "hour" on a document line, per language. */
const UNITS: Record<Locale, { piece: string; hour: string }> = {
  de: { piece: "Stk", hour: "Std" },
  en: { piece: "pcs", hour: "h" },
  ru: { piece: "шт.", hour: "ч" },
  uk: { piece: "шт.", hour: "год" },
  kk: { piece: "дана", hour: "сағ" },
  es: { piece: "u.", hour: "h" },
};

export function defaultUnit(locale: string, kind: "piece" | "hour" = "piece"): string {
  return (UNITS[locale as Locale] ?? UNITS.de)[kind];
}

/** The region of a company row. */
export function regionOf(org: { country: string; currency: string; taxRates?: number[] | null }): Region {
  return { country: org.country, currency: org.currency, taxRates: org.taxRates ?? null };
}

/** The language as written in the company's country: English in the US → en-US, in Germany → en-DE. */
export function intlTag(locale: Locale, region: Region = DEFAULT_REGION): string {
  return `${locale}-${region.country}`;
}

/** Money as the locale writes it: 1.234,50 € / $1,234.50. Amounts are cents. */
export function formatMoney(cents: number, locale: Locale, region: Region = DEFAULT_REGION): string {
  return new Intl.NumberFormat(intlTag(locale, region), { style: "currency", currency: region.currency }).format(cents / 100);
}

export function formatDate(value: Date | string, locale: Locale, region: Region = DEFAULT_REGION): string {
  return new Intl.DateTimeFormat(intlTag(locale, region), { dateStyle: "medium" }).format(new Date(value));
}

/** A tax rate as the locale writes it: 19 %, 8.875 %, 5,5 %. */
export function formatRate(rate: number, locale: Locale, region: Region = DEFAULT_REGION): string {
  return `${new Intl.NumberFormat(intlTag(locale, region), { maximumFractionDigits: 3 }).format(rate)} %`;
}
