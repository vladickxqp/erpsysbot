/**
 * DATEV export for the tax adviser: a "Buchungsstapel" (EXTF, format 700) with
 * the issued invoices and credit notes of a period, split by tax rate, and the
 * payments received on them. Revenue goes to the automatic accounts of SKR03
 * or SKR04 (tax included), clients to debtor accounts 10000 + client number.
 *
 * Expenses are not part of it: their accounts and input tax need the
 * receipts, which the adviser books themselves.
 */
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { clients, invoiceItems, invoices, organizations, payments } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { displayName } from "./clients";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

export const datevSettings = z.object({
  consultant: z.coerce.number().int().min(1001).max(9_999_999),
  client: z.coerce.number().int().min(1).max(99_999),
  chart: z.enum(["SKR03", "SKR04"]).default("SKR03"),
  /** First month of the fiscal year (1–12). */
  fiscalStartMonth: z.coerce.number().int().min(1).max(12).default(1),
});
export type DatevSettings = z.output<typeof datevSettings>;

export function datevOf(raw: unknown): DatevSettings | null {
  const parsed = datevSettings.safeParse(raw ?? {});
  return parsed.success ? parsed.data : null;
}

export async function saveDatevSettings(ctx: Context, raw: Record<string, unknown>): Promise<DatevSettings> {
  requirePermission(ctx.permissions, "settings.manage");
  const value = datevSettings.parse(raw);
  await getDb().update(organizations).set({ datev: value }).where(eq(organizations.id, ctx.organization.id));
  return value;
}

const ACCOUNTS = {
  SKR03: { revenue: { 19: 8400, 7: 8300 } as Record<number, number>, taxFree: 8100, smallBusiness: 8195, bank: 1200, cash: 1000 },
  SKR04: { revenue: { 19: 4400, 7: 4300 } as Record<number, number>, taxFree: 4100, smallBusiness: 4185, bank: 1800, cash: 1600 },
};

/** Text for DATEV: quotes doubled, no line breaks or semicolons, at most `max` characters. */
const text = (value: string, max: number) => `"${value.replace(/[\r\n;]+/g, " ").replace(/"/g, '""').slice(0, max)}"`;
const amount = (cents: number) => (Math.abs(cents) / 100).toFixed(2).replace(".", ",");
const ddmm = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;
const compact = (iso: string) => iso.replace(/-/g, "");

/** Windows-1252, the code page DATEV reads. */
export function cp1252(value: string): Uint8Array {
  const special: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97 };
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    out[i] = special[value[i]] ?? (c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : 0x3f);
  }
  return out;
}

export type DatevRow = { cents: number; side: "S" | "H"; account: number; contra: number; date: string; document: string; text: string };

/** Splits an invoice's gross over its tax rates, so the parts add up to the cent. */
export function grossByRate(lines: { vatRate: number; netCents: number }[], grossCents: number, smallBusiness: boolean): { rate: number; cents: number }[] {
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + l.netCents);
  const parts = [...byRate.entries()].map(([rate, net]) => ({ rate, cents: smallBusiness ? net : net + Math.round((net * rate) / 100) }));
  if (parts.length) parts[parts.length - 1].cents += grossCents - parts.reduce((sum, p) => sum + p.cents, 0);
  return parts.filter((p) => p.cents !== 0);
}

/** The bookings of a period: invoices and credit notes by issue date, payments by payment date. */
export async function datevRows(ctx: Context, from: string, to: string, chart: "SKR03" | "SKR04"): Promise<DatevRow[]> {
  requirePermission(ctx.permissions, "finance.export");
  const acc = ACCOUNTS[chart];
  return withTenant(ctx.organization.id, async (tx) => {
    const issued = await tx
      .select({ invoice: invoices, client: clients })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(and(inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"]), gte(invoices.issueDate, from), lte(invoices.issueDate, to)))
      .orderBy(asc(invoices.issueDate), asc(invoices.number));
    const ids = issued.map((r) => r.invoice.id);
    const lines = ids.length
      ? await tx.select({ invoiceId: invoiceItems.invoiceId, vatRate: invoiceItems.vatRate, netCents: invoiceItems.netCents }).from(invoiceItems).where(inArray(invoiceItems.invoiceId, ids))
      : [];
    const rows: DatevRow[] = [];
    for (const { invoice, client } of issued) {
      const debtor = 10000 + client.number;
      const credit = invoice.kind === "CREDIT_NOTE";
      for (const part of grossByRate(lines.filter((l) => l.invoiceId === invoice.id), invoice.grossCents, invoice.smallBusiness)) {
        const contra = invoice.smallBusiness ? acc.smallBusiness : (acc.revenue[part.rate] ?? acc.taxFree);
        const negative = part.cents < 0;
        rows.push({
          cents: part.cents,
          side: credit !== negative ? "H" : "S",
          account: debtor,
          contra,
          date: invoice.issueDate!,
          document: invoice.number ?? "",
          text: displayName(client),
        });
      }
    }
    const paid = await tx
      .select({ payment: payments, invoice: invoices, client: clients })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(and(gte(payments.paidOn, from), lte(payments.paidOn, to)))
      .orderBy(asc(payments.paidOn));
    for (const { payment, invoice, client } of paid) {
      rows.push({
        cents: payment.amountCents,
        side: "S",
        account: payment.method === "CASH" ? acc.cash : acc.bank,
        contra: 10000 + client.number,
        date: payment.paidOn,
        document: invoice.number ?? "",
        text: `${displayName(client)} ${invoice.number ?? ""}`.trim(),
      });
    }
    return rows;
  });
}

/** The EXTF file (Windows-1252). One file per fiscal year: DATEV takes no stack across years. */
export async function datevExport(ctx: Context, from: string, to: string): Promise<{ filename: string; bytes: Uint8Array; rows: number }> {
  requirePermission(ctx.permissions, "finance.export");
  const settings = datevOf(ctx.organization.datev);
  if (!settings) throw new DatevError("NOT_SET_UP");
  const year = Number(from.slice(0, 4));
  const startMonth = settings.fiscalStartMonth;
  const fiscalYear = Number(from.slice(5, 7)) >= startMonth ? year : year - 1;
  const fiscalStart = `${fiscalYear}-${String(startMonth).padStart(2, "0")}-01`;
  const fiscalEnd = new Date(Date.UTC(fiscalYear + 1, startMonth - 1, 0)).toISOString().slice(0, 10);
  if (from < fiscalStart || to > fiscalEnd || from > to) throw new DatevError("ONE_YEAR");

  const rows = await datevRows(ctx, from, to, settings.chart);
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
  const header = [
    '"EXTF"', "700", "21", '"Buchungsstapel"', "13", stamp, "", '"RE"', '""', '""',
    String(settings.consultant), String(settings.client), compact(fiscalStart), "4", compact(from), compact(to),
    text(`Ausgangsrechnungen ${from} bis ${to}`, 30), '""', "1", "0", "0", text(ctx.organization.currency, 3),
    "", '""', "", "", `"${settings.chart.slice(3)}"`, "", "", '""', '""',
  ].join(";");
  const columns = [
    "Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs", "Basis-Umsatz", "WKZ Basis-Umsatz",
    "Konto", "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum", "Belegfeld 1", "Belegfeld 2", "Skonto", "Buchungstext",
  ].join(";");
  const lines = rows.map((r) =>
    [amount(r.cents), `"${r.side}"`, text(ctx.organization.currency, 3), "", "", '""', String(r.account), String(r.contra), '""', ddmm(r.date), text(r.document, 36), '""', "", text(r.text, 60)].join(";"),
  );
  const content = [header, columns, ...lines].join("\r\n") + "\r\n";
  return { filename: `EXTF_Buchungsstapel_${compact(from)}_${compact(to)}.csv`, bytes: cp1252(content), rows: rows.length };
}

export class DatevError extends Error {
  constructor(public readonly code: "NOT_SET_UP" | "ONE_YEAR") {
    super(code);
  }
}
