/**
 * Three languages from the start (de, en, ru); another one is a new file in
 * ./messages with the same keys — TypeScript refuses a missing one.
 */
import de, { type Messages } from "./messages/de";
import en from "./messages/en";
import ru from "./messages/ru";

export const LOCALES = ["de", "en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "de";
export const LOCALE_COOKIE = "erp_locale";

export const MESSAGES: Record<Locale, Messages> = { de, en, ru };
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

/** Money as the locale writes it: 1.234,50 € / €1,234.50. Amounts are cents. */
export function formatMoney(cents: number, locale: Locale, currency = "EUR"): string {
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : locale, { style: "currency", currency }).format(cents / 100);
}

export function formatDate(value: Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, { dateStyle: "medium" }).format(new Date(value));
}
