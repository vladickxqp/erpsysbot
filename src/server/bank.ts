/**
 * Bank statements: import CAMT.053 (the XML every German bank offers) or a
 * CSV export, keep each line once, and turn it into bookings — a payment on
 * an invoice, an income or an expense — or ignore it.
 *
 * Money in whose purpose names an open invoice's number with exactly the open
 * amount is matched on import; everything else waits for a person, with the
 * likeliest invoice suggested.
 */
import { openCents } from "@/lib/invoicing";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { bankTransactions, clients, invoices } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { audit } from "./audit";
import { displayName, NotFoundError } from "./clients";
import type { Context } from "./context";
import { createTransaction } from "./finance";
import { parseCsv } from "./import";
import { recordPayment } from "./invoices";
import { requirePermission } from "./permissions";

export type StatementLine = { bookedOn: string; amountCents: number; currency: string; counterparty: string | null; iban: string | null; purpose: string | null; ref: string | null };

export class BankError extends Error {
  constructor(public readonly code: "UNREADABLE" | "EMPTY" | "NOT_NEW" | "AMOUNT") {
    super(code);
  }
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
const tag = (xml: string, path: string): string | null => {
  let scope = xml;
  for (const name of path.split("/")) {
    const m = scope.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
    if (!m) return null;
    scope = m[1];
  }
  return decode(scope);
};
const allTags = (xml: string, name: string): string[] =>
  [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "g"))].map((m) => m[1]);

const cents = (value: string) => Math.round(Number(value) * 100);

/** CAMT.052/053/054: one line per entry (Ntry), the first transaction's details. */
export function parseCamt(xml: string): StatementLine[] {
  return allTags(xml, "Ntry").map((entry) => {
    const amountMatch = entry.match(/<(?:\w+:)?Amt(?:\s+Ccy="([A-Z]{3})")?[^>]*>([\d.]+)</);
    if (!amountMatch) throw new BankError("UNREADABLE");
    const credit = tag(entry, "CdtDbtInd") === "CRDT";
    const details = allTags(entry, "TxDtls")[0] ?? entry;
    const party = credit ? "Dbtr" : "Cdtr";
    const name = tag(details, `RltdPties/${party}/Nm`) ?? tag(details, `RltdPties/${party}/Pty/Nm`);
    const iban = tag(details, `RltdPties/${party}Acct/Id/IBAN`);
    const purpose = allTags(details, "Ustrd").map(decode).join(" ") || tag(entry, "AddtlNtryInf");
    const date = (tag(entry, "BookgDt/Dt") ?? tag(entry, "BookgDt/DtTm") ?? tag(entry, "ValDt/Dt") ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BankError("UNREADABLE");
    const value = cents(amountMatch[2]);
    return {
      bookedOn: date,
      amountCents: credit ? value : -value,
      currency: amountMatch[1] ?? "EUR",
      counterparty: name,
      iban: iban?.replace(/\s/g, "") ?? null,
      purpose,
      ref: tag(entry, "AcctSvcrRef") ?? tag(details, "Refs/EndToEndId") ?? tag(entry, "NtryRef"),
    };
  });
}

const HEADERS = {
  date: ["buchungstag", "buchungsdatum", "datum", "date", "booking date", "valutadatum", "wertstellung"],
  amount: ["betrag", "betrag (eur)", "betrag (€)", "umsatz", "amount", "betrag in eur"],
  purpose: ["verwendungszweck", "buchungstext", "purpose", "beschreibung", "description", "vorgang/verwendungszweck"],
  name: ["beguenstigter/zahlungspflichtiger", "begünstigter/zahlungspflichtiger", "name zahlungsbeteiligter", "auftraggeber/empfänger", "empfänger", "zahlungsempfänger", "name", "counterparty", "auftraggeber"],
  iban: ["iban zahlungsbeteiligter", "kontonummer/iban", "iban", "gegenkonto"],
  currency: ["währung", "waehrung", "currency"],
};

/** "1.234,56", "-12,30", "1,234.56", "12.5" → cents. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[\s€A-Z]/gi, "");
  if (!s) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma > dot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** "31.12.2026", "31.12.26", "2026-12-31" → "2026-12-31". */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** A bank's CSV export: the header row is found by its column names (banks put lines above it). */
export function parseBankCsv(text: string): StatementLine[] {
  const rows = parseCsv(text);
  const find = (cells: string[], names: string[]) => cells.findIndex((c) => names.includes(c.trim().toLowerCase().replace(/^"|"$/g, "")));
  const start = rows.findIndex((r) => find(r, HEADERS.date) >= 0 && find(r, HEADERS.amount) >= 0);
  if (start < 0) throw new BankError("UNREADABLE");
  const head = rows[start];
  const col = Object.fromEntries(Object.entries(HEADERS).map(([k, names]) => [k, find(head, names)])) as Record<keyof typeof HEADERS, number>;
  const lines: StatementLine[] = [];
  for (const row of rows.slice(start + 1)) {
    const date = parseDate(row[col.date] ?? "");
    const amount = parseAmount(row[col.amount] ?? "");
    if (!date || amount === null || amount === 0) continue;
    const cell = (i: number) => (i >= 0 ? row[i]?.trim() || null : null);
    lines.push({
      bookedOn: date,
      amountCents: amount,
      currency: cell(col.currency)?.toUpperCase().slice(0, 3) || "EUR",
      counterparty: cell(col.name),
      iban: cell(col.iban)?.replace(/\s/g, "") ?? null,
      purpose: cell(col.purpose),
      ref: null,
    });
  }
  return lines;
}

const keyOf = (l: StatementLine, n: number) =>
  createHash("sha256")
    .update([l.ref ?? "", l.bookedOn, l.amountCents, l.counterparty ?? "", l.purpose ?? "", l.ref ? "" : n].join("|"))
    .digest("hex");

/** Imports a statement; lines already imported are skipped. Clear matches are booked right away. */
export async function importStatement(ctx: Context, file: { name: string; bytes: Uint8Array }) {
  requirePermission(ctx.permissions, "finance.create");
  const text = new TextDecoder("utf-8").decode(file.bytes);
  const xml = /^\s*(<\?xml|<Document)/.test(text) || file.name.toLowerCase().endsWith(".xml");
  // Banks still export CSV in Windows-1252: unreadable as UTF-8 → read as Latin-1.
  const source = !xml && text.includes("�") ? new TextDecoder("windows-1252").decode(file.bytes) : text;
  const lines = xml ? parseCamt(source) : parseBankCsv(source);
  if (!lines.length) throw new BankError("EMPTY");
  // The same line twice in one file (two equal transfers on a day) stays twice.
  const seen = new Map<string, number>();
  const rows = lines.map((l) => {
    const base = `${l.bookedOn}|${l.amountCents}|${l.counterparty}|${l.purpose}|${l.ref}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return {
      organizationId: ctx.organization.id,
      bookedOn: l.bookedOn,
      amountCents: l.amountCents,
      currency: l.currency,
      counterparty: l.counterparty?.slice(0, 200) ?? null,
      counterpartyIban: l.iban?.slice(0, 40) ?? null,
      purpose: l.purpose?.slice(0, 1000) ?? null,
      dedupeKey: keyOf(l, n),
      importedBy: ctx.user.userId,
    };
  });
  const inserted = await withTenant(ctx.organization.id, async (tx) => {
    const added = await tx.insert(bankTransactions).values(rows).onConflictDoNothing().returning();
    await audit(tx, ctx, "bank.import", "bank", null, { name: file.name, lines: rows.length, added: added.length });
    return added;
  });
  let matched = 0;
  if (ctx.permissions.has("invoices.read")) {
    const open = await openInvoices(ctx);
    for (const line of inserted) {
      const sure = suggest(line, open).find((s) => s.sure);
      if (!sure) continue;
      try {
        await matchInvoice(ctx, line.id, sure.invoiceId);
        matched++;
      } catch {
        // left for a person to look at
      }
    }
  }
  return { lines: rows.length, imported: inserted.length, skipped: rows.length - inserted.length, matched };
}

type OpenInvoice = { id: string; number: string | null; openCents: number; clientName: string };

async function openInvoices(ctx: Context): Promise<OpenInvoice[]> {
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ invoice: invoices, client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName } })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      // A statement is in the company's currency: invoices in another one are matched by hand in their own amount.
      .where(and(eq(invoices.kind, "INVOICE"), inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID"]), isNull(invoices.currency)));
    return rows.map((r) => ({ id: r.invoice.id, number: r.invoice.number, openCents: openCents(r.invoice), clientName: displayName(r.client) }));
  });
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Likely invoices for money in: by number in the purpose, then by amount and name. */
export function suggest(line: { amountCents: number; purpose: string | null; counterparty: string | null }, open: OpenInvoice[]) {
  if (line.amountCents <= 0) return [];
  const purpose = squash(line.purpose ?? "");
  const who = squash(line.counterparty ?? "");
  const out: { invoiceId: string; number: string | null; clientName: string; openCents: number; sure: boolean }[] = [];
  for (const inv of open) {
    const byNumber = !!inv.number && purpose.includes(squash(inv.number));
    const sameAmount = inv.openCents === line.amountCents;
    const words = inv.clientName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const byName = !!who && words.some((w) => who.includes(squash(w)));
    if (byNumber || (sameAmount && byName)) out.push({ invoiceId: inv.id, number: inv.number, clientName: inv.clientName, openCents: inv.openCents, sure: byNumber && sameAmount });
  }
  if (!out.length) {
    const same = open.filter((inv) => inv.openCents === line.amountCents);
    if (same.length === 1) out.push({ invoiceId: same[0].id, number: same[0].number, clientName: same[0].clientName, openCents: same[0].openCents, sure: false });
  }
  return out.sort((a, b) => Number(b.sure) - Number(a.sure)).slice(0, 3);
}

export const BANK_STATUSES = ["NEW", "MATCHED", "BOOKED", "IGNORED"] as const;

export async function listBank(ctx: Context, status: (typeof BANK_STATUSES)[number] = "NEW") {
  requirePermission(ctx.permissions, "finance.read");
  const rows = await withTenant(ctx.organization.id, (tx) =>
    tx.select().from(bankTransactions).where(eq(bankTransactions.status, status)).orderBy(desc(bankTransactions.bookedOn), desc(bankTransactions.createdAt)).limit(500),
  );
  const open = status === "NEW" && ctx.permissions.has("invoices.read") ? await openInvoices(ctx) : [];
  return {
    rows: rows.map((r) => ({ ...r, suggestions: status === "NEW" ? suggest(r, open) : [] })),
    open: open.map((o) => ({ id: o.id, label: `${o.number ?? "—"} · ${o.clientName}`, openCents: o.openCents })),
  };
}

async function newLine(ctx: Context, id: string) {
  const [line] = await withTenant(ctx.organization.id, (tx) => tx.select().from(bankTransactions).where(eq(bankTransactions.id, id)));
  if (!line) throw new NotFoundError();
  if (line.status !== "NEW") throw new BankError("NOT_NEW");
  return line;
}

/** Money in → a payment on the invoice (which also books the income). */
export async function matchInvoice(ctx: Context, id: string, invoiceId: string): Promise<void> {
  const line = await newLine(ctx, id);
  if (line.amountCents <= 0) throw new BankError("AMOUNT");
  await recordPayment(ctx, invoiceId, { amountCents: line.amountCents, paidOn: line.bookedOn, method: "TRANSFER", note: line.purpose?.slice(0, 500) });
  await withTenant(ctx.organization.id, (tx) => tx.update(bankTransactions).set({ status: "MATCHED", invoiceId }).where(eq(bankTransactions.id, id)));
}

/** Any line → an income or expense in finance (with a category for expenses). */
export async function bookLine(ctx: Context, id: string, category: string | null = null): Promise<void> {
  const line = await newLine(ctx, id);
  const t = await createTransaction(ctx, {
    type: line.amountCents > 0 ? "INCOME" : "EXPENSE",
    amountCents: Math.abs(line.amountCents),
    bookedOn: line.bookedOn,
    category: line.amountCents > 0 ? null : category,
    description: [line.counterparty, line.purpose].filter(Boolean).join(" · ").slice(0, 500),
    method: "TRANSFER",
  });
  await withTenant(ctx.organization.id, (tx) => tx.update(bankTransactions).set({ status: "BOOKED", transactionId: t.id }).where(eq(bankTransactions.id, id)));
}

export async function setIgnored(ctx: Context, id: string, ignored: boolean): Promise<void> {
  requirePermission(ctx.permissions, "finance.create");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .update(bankTransactions)
      .set({ status: ignored ? "IGNORED" : "NEW" })
      .where(and(eq(bankTransactions.id, id), inArray(bankTransactions.status, ignored ? ["NEW"] : ["IGNORED"])))
      .returning({ id: bankTransactions.id });
    if (!row) throw new NotFoundError();
  });
}
