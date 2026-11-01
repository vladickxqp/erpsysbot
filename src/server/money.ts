/**
 * Amounts, lines and totals.
 *
 * Money is integer cents everywhere. A line's net is rounded once (quantity ×
 * unit price × (1 − discount)); VAT is computed per rate on the sum of that
 * rate's lines and rounded once per rate — the way German invoices state it
 * ("19 % USt. auf 1.234,56 €"). A small business (§ 19 UStG) charges none.
 */
import { z } from "zod";

export const VAT_RATES = [19, 7, 0] as const;

export const lineInput = z.object({
  productId: z.string().uuid().nullish(),
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(20).default("Stk"),
  unitPriceCents: z.coerce.number().int().min(-100_000_000).max(100_000_000),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  vatRate: z.coerce.number().int().refine((r) => (VAT_RATES as readonly number[]).includes(r), "vat"),
});
export type LineInput = z.input<typeof lineInput>;
export type Line = z.output<typeof lineInput>;

export const linesInput = z.array(lineInput).min(1).max(200);

export function lineNet(line: Pick<Line, "quantity" | "unitPriceCents" | "discountPercent">): number {
  return Math.round(line.quantity * line.unitPriceCents * (1 - line.discountPercent / 100));
}

export type Totals = {
  netCents: number;
  vatCents: number;
  grossCents: number;
  byRate: { rate: number; netCents: number; vatCents: number }[];
};

export function totals(lines: Line[], smallBusiness = false): Totals {
  const byRate = new Map<number, number>();
  for (const line of lines) {
    const rate = smallBusiness ? 0 : line.vatRate;
    byRate.set(rate, (byRate.get(rate) ?? 0) + lineNet(line));
  }
  const groups = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, net]) => ({ rate, netCents: net, vatCents: Math.round((net * rate) / 100) }));
  const netCents = groups.reduce((s, g) => s + g.netCents, 0);
  const vatCents = groups.reduce((s, g) => s + g.vatCents, 0);
  return { netCents, vatCents, grossCents: netCents + vatCents, byRate: groups };
}

/** "1.234,56" / "1234.56" / "12" → cents. Null when it is no amount. */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[\s€]/g, "");
  if (!cleaned) return null;
  // The last , or . with one or two digits after it is the decimal mark.
  const match = cleaned.match(/^(-?)([\d.,]*?)(?:[.,](\d{1,2}))?$/);
  if (!match) return null;
  const whole = match[2].replace(/[.,]/g, "");
  if (!/^\d*$/.test(whole) || (!whole && !match[3])) return null;
  const cents = Number(whole || "0") * 100 + Number((match[3] ?? "0").padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

/** Today in the company's time zone, as YYYY-MM-DD. */
export function today(timeZone = "Europe/Berlin", at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "RE-{YYYY}-{NNNN}" with 2026 and 7 → "RE-2026-0007". */
export function formatNumber(pattern: string, year: number, n: number): string {
  return pattern
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{YY\}/g, String(year).slice(-2))
    .replace(/\{(N+)\}/g, (_, ns: string) => String(n).padStart(ns.length, "0"));
}
