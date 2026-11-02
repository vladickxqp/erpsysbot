/**
 * Quotes (Angebote): what we offer a client, line by line, before anything
 * is ordered. Numbered when created (AN-2026-0001), editable until accepted
 * or declined; an accepted quote becomes an order or an invoice draft with
 * the same lines, and remembers which.
 */
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/tenant";
import { clients, quoteItems, quotes } from "@/db/schema";
import { audit, type Via } from "./audit";
import { displayName, NotFoundError } from "./clients";
import type { Context } from "./context";
import { createInvoiceDraft } from "./invoices";
import { addDays, checkRates, formatNumber, linesInput, today, totals } from "./money";
import { nextNumber } from "./numbers";
import { asLines, createOrder, lineRows } from "./orders";
import { requirePermission } from "./permissions";

export const QUOTE_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

const QUOTE_VALID_DAYS = 30;

export class QuoteStateError extends Error {
  constructor(public readonly code: "CLOSED" | "NOT_ACCEPTED" | "CONVERTED") {
    super(code);
  }
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .transform((v) => v || null);

export const quoteInput = z.object({
  clientId: z.string().uuid(),
  title: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  notes: z
    .string()
    .trim()
    .max(5000)
    .nullish()
    .transform((v) => v || null),
  validUntil: isoDate,
  items: linesInput,
});
export type QuoteInput = z.input<typeof quoteInput>;
export type Quote = typeof quotes.$inferSelect;

async function clientInCompany(tx: Tx, clientId: string) {
  const [row] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!row) throw new NotFoundError();
}

export async function createQuote(ctx: Context, raw: QuoteInput, via: Via = "web"): Promise<Quote> {
  requirePermission(ctx.permissions, "orders.create");
  const input = quoteInput.parse(raw);
  checkRates(input.items, ctx.organization);
  const org = ctx.organization;
  const sum = totals(input.items, org.smallBusiness);
  return withTenant(org.id, async (tx) => {
    await clientInCompany(tx, input.clientId);
    const issued = today(org.timezone);
    const year = Number(issued.slice(0, 4));
    const number = formatNumber(org.quoteNumberFormat, year, await nextNumber(tx, org.id, `quote-${year}`));
    const [row] = await tx
      .insert(quotes)
      .values({
        organizationId: org.id,
        number,
        clientId: input.clientId,
        title: input.title,
        notes: input.notes,
        issueDate: issued,
        validUntil: input.validUntil ?? addDays(issued, QUOTE_VALID_DAYS),
        netCents: sum.netCents,
        vatCents: sum.vatCents,
        grossCents: sum.grossCents,
        smallBusiness: org.smallBusiness,
      })
      .returning();
    await tx.insert(quoteItems).values(lineRows(org.id, input.items).map((l) => ({ ...l, quoteId: row.id })));
    await tx.update(clients).set({ lastInteractionAt: new Date() }).where(eq(clients.id, input.clientId));
    await audit(tx, ctx, "quote.create", "quote", row.id, { number, gross: sum.grossCents }, via);
    return row;
  });
}

async function openQuote(tx: Tx, id: string): Promise<Quote> {
  const [row] = await tx.select().from(quotes).where(eq(quotes.id, id)).limit(1);
  if (!row) throw new NotFoundError();
  if (row.status === "ACCEPTED" || row.status === "DECLINED") throw new QuoteStateError("CLOSED");
  return row;
}

export async function updateQuote(ctx: Context, id: string, raw: QuoteInput, via: Via = "web"): Promise<Quote> {
  requirePermission(ctx.permissions, "orders.update");
  const input = quoteInput.parse(raw);
  checkRates(input.items, ctx.organization);
  const sum = totals(input.items, ctx.organization.smallBusiness);
  return withTenant(ctx.organization.id, async (tx) => {
    await openQuote(tx, id);
    await clientInCompany(tx, input.clientId);
    const [row] = await tx
      .update(quotes)
      .set({
        clientId: input.clientId,
        title: input.title,
        notes: input.notes,
        validUntil: input.validUntil,
        netCents: sum.netCents,
        vatCents: sum.vatCents,
        grossCents: sum.grossCents,
        smallBusiness: ctx.organization.smallBusiness,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, id))
      .returning();
    await tx.delete(quoteItems).where(eq(quoteItems.quoteId, id));
    await tx.insert(quoteItems).values(lineRows(ctx.organization.id, input.items).map((l) => ({ ...l, quoteId: id })));
    await audit(tx, ctx, "quote.update", "quote", id, { gross: sum.grossCents }, via);
    return row;
  });
}

/** DRAFT → SENT → ACCEPTED or DECLINED. A closed quote stays closed. */
export async function setQuoteStatus(ctx: Context, id: string, status: QuoteStatus, via: Via = "web"): Promise<Quote> {
  requirePermission(ctx.permissions, "orders.update");
  return withTenant(ctx.organization.id, async (tx) => {
    const current = await openQuote(tx, id);
    if (current.status === status) return current;
    const [row] = await tx.update(quotes).set({ status, updatedAt: new Date() }).where(eq(quotes.id, id)).returning();
    await audit(tx, ctx, "quote.status", "quote", id, { status }, via);
    return row;
  });
}

export async function deleteQuote(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "orders.delete");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(quotes).where(and(eq(quotes.id, id), eq(quotes.status, "DRAFT"))).returning({ number: quotes.number });
    if (!row) throw new QuoteStateError("CLOSED");
    await audit(tx, ctx, "quote.delete", "quote", id, { number: row.number });
  });
}

export async function getQuote(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, id)).limit(1);
    if (!quote) throw new NotFoundError();
    const items = await tx.select().from(quoteItems).where(eq(quoteItems.quoteId, id)).orderBy(asc(quoteItems.position));
    const [client] = await tx.select().from(clients).where(eq(clients.id, quote.clientId)).limit(1);
    return { quote, items, client, clientName: client ? displayName(client) : "—" };
  });
}

/** Accepting turns the quote into an order with the same lines (once). */
export async function quoteToOrder(ctx: Context, id: string, via: Via = "web") {
  const { quote, items } = await getQuote(ctx, id);
  if (quote.orderId) throw new QuoteStateError("CONVERTED");
  if (quote.status === "DECLINED") throw new QuoteStateError("CLOSED");
  const order = await createOrder(
    ctx,
    { clientId: quote.clientId, status: "CONFIRMED", title: quote.title ?? quote.number, notes: quote.notes, items: asLines(items) },
    via,
  );
  await withTenant(ctx.organization.id, (tx) =>
    tx.update(quotes).set({ status: "ACCEPTED", orderId: order.id, updatedAt: new Date() }).where(eq(quotes.id, id)),
  );
  return order;
}

/** Or straight into an invoice draft (small jobs without an order). */
export async function quoteToInvoice(ctx: Context, id: string, via: Via = "web") {
  const { quote, items } = await getQuote(ctx, id);
  if (quote.invoiceId) throw new QuoteStateError("CONVERTED");
  if (quote.status === "DECLINED") throw new QuoteStateError("CLOSED");
  const draft = await createInvoiceDraft(ctx, { clientId: quote.clientId, orderId: quote.orderId, notes: quote.notes, items: asLines(items) }, via);
  await withTenant(ctx.organization.id, (tx) =>
    tx.update(quotes).set({ status: "ACCEPTED", invoiceId: draft.id, updatedAt: new Date() }).where(eq(quotes.id, id)),
  );
  return draft;
}

export async function listQuotes(ctx: Context, query: { q?: string; status?: QuoteStatus; clientId?: string; page?: number; pageSize?: number } = {}) {
  requirePermission(ctx.permissions, "orders.read");
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const filters: SQL[] = [];
  if (query.status) filters.push(eq(quotes.status, query.status));
  if (query.clientId) filters.push(eq(quotes.clientId, query.clientId));
  const q = query.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    filters.push(or(ilike(quotes.number, like), ilike(quotes.title, like), ilike(clients.companyName, like), ilike(clients.lastName, like))!);
  }
  const where = filters.length ? and(...filters) : undefined;
  const now = today(ctx.organization.timezone);
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ quote: quotes, client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName } })
      .from(quotes)
      .innerJoin(clients, eq(clients.id, quotes.clientId))
      .where(where)
      .orderBy(desc(quotes.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(quotes)
      .innerJoin(clients, eq(clients.id, quotes.clientId))
      .where(where);
    return {
      rows: rows.map((r) => ({
        ...r.quote,
        clientName: displayName(r.client),
        expired: (r.quote.status === "DRAFT" || r.quote.status === "SENT") && !!r.quote.validUntil && r.quote.validUntil < now,
      })),
      total,
      page,
      pageSize,
    };
  });
}
