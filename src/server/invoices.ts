/**
 * Invoices and credit notes.
 *
 * A **draft** may change freely and has no number. **Issuing** freezes it:
 * the next number of the year (no gaps — taken in the same transaction), the
 * seller's and the buyer's data as they are today, the issue and due date.
 * From then on the database itself (db/rls.sql, invoices_guard) refuses any
 * change to its figures, lines or parties; only payments move its state.
 * A wrong issued invoice is **cancelled by a credit note** that mirrors it —
 * never edited, never deleted.
 *
 * Nothing here claims legal compliance (GoBD, XRechnung, ZUGFeRD): the
 * structure follows those rules, the formats come later and need checking.
 */
import { and, asc, desc, eq, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/tenant";
import { clients, invoiceItems, invoices, orderItems, orders, payments, transactions } from "@/db/schema";
import { audit, type Via } from "./audit";
import { displayName, NotFoundError } from "./clients";
import type { Context, Organization } from "./context";
import { addDays, checkRates, formatNumber, linesInput, today, totals } from "./money";
import { nextNumber } from "./numbers";
import { asLines, lineRows } from "./orders";
import { requirePermission } from "./permissions";
import { countryProfile } from "@/lib/countries";
import { PAYMENT_METHODS } from "@/lib/domain";

export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;

export class InvoiceStateError extends Error {
  constructor(
    public readonly code: "NOT_DRAFT" | "NOT_OPEN" | "OVERPAID" | "COMPANY_INCOMPLETE" | "NOT_CANCELLABLE",
    public readonly missing: string[] = [],
  ) {
    super(code);
  }
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .transform((v) => v || null);

export const invoiceInput = z.object({
  clientId: z.string().uuid(),
  orderId: z.string().uuid().nullish(),
  serviceDate: isoDate,
  dueDate: isoDate,
  notes: z
    .string()
    .trim()
    .max(5000)
    .nullish()
    .transform((v) => v || null),
  items: linesInput,
  /** Another currency than the company's, with its rate; left out: the company's. */
  currency: z.string().trim().toUpperCase().length(3).nullish().transform((v) => v || null),
  exchangeRate: z.coerce.number().positive().max(1_000_000).nullish().transform((v) => v || null),
});
export type InvoiceInput = z.input<typeof invoiceInput>;

/** Only a real foreign currency is kept, and it needs its rate. */
function foreignCurrency(org: Organization, input: { currency: string | null; exchangeRate: number | null }) {
  if (!input.currency || input.currency === org.currency) return { currency: null, exchangeRate: null };
  if (!Intl.supportedValuesOf("currency").includes(input.currency) || !input.exchangeRate) {
    throw new z.ZodError([{ code: "custom", path: ["exchangeRate"], message: "rate" }]);
  }
  return { currency: input.currency, exchangeRate: input.exchangeRate };
}

/** An amount of this invoice in the company's currency. */
export const inBase = (cents: number, invoice: { exchangeRate: number | null }) => Math.round(cents * (invoice.exchangeRate ?? 1));

export type Party = {
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  vatId: string | null;
  number?: number;
};

export type Seller = Party & {
  legalName: string | null;
  taxNumber: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  iban: string | null;
  bic: string | null;
  bankName: string | null;
  footer: string | null;
  /** Missing in snapshots issued before currencies existed: those were euro. */
  currency?: string;
};

/** What an invoice must name about the seller before it can be issued: an address everywhere, a tax number where the country asks for one. */
export function missingCompanyData(org: Organization): string[] {
  const missing: string[] = [];
  if (!org.street) missing.push("street");
  if (!org.postalCode && org.country !== "AE") missing.push("postalCode");
  if (!org.city) missing.push("city");
  if (countryProfile(org.country).requiresTaxId && !org.vatId && !org.taxNumber) missing.push("taxNumber");
  return missing;
}

export function sellerOf(org: Organization): Seller {
  return {
    name: org.legalName || org.name,
    legalName: org.legalName,
    street: org.street,
    postalCode: org.postalCode,
    city: org.city,
    country: org.country,
    vatId: org.vatId,
    taxNumber: org.taxNumber,
    email: org.email,
    phone: org.phone,
    website: org.website,
    iban: org.iban,
    bic: org.bic,
    bankName: org.bankName,
    footer: org.invoiceFooter,
    currency: org.currency,
  };
}

export async function clientParty(tx: Tx, clientId: string): Promise<Party> {
  const [c] = await tx.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!c) throw new NotFoundError();
  const person = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return {
    name: c.companyName ? (person ? `${c.companyName}\n${person}` : c.companyName) : person,
    street: c.street,
    postalCode: c.postalCode,
    city: c.city,
    country: c.country,
    vatId: c.vatId,
    number: c.number,
  };
}

async function draftOf(tx: Tx, id: string): Promise<Invoice> {
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!row) throw new NotFoundError();
  if (row.status !== "DRAFT") throw new InvoiceStateError("NOT_DRAFT");
  return row;
}

export async function createInvoiceDraft(ctx: Context, raw: InvoiceInput, via: Via = "web"): Promise<Invoice> {
  requirePermission(ctx.permissions, "invoices.create");
  const input = invoiceInput.parse(raw);
  checkRates(input.items, ctx.organization);
  const sum = totals(input.items, ctx.organization.smallBusiness);
  return withTenant(ctx.organization.id, async (tx) => {
    await clientParty(tx, input.clientId);
    const [row] = await tx
      .insert(invoices)
      .values({
        organizationId: ctx.organization.id,
        clientId: input.clientId,
        orderId: input.orderId ?? null,
        serviceDate: input.serviceDate,
        dueDate: input.dueDate,
        notes: input.notes,
        ...foreignCurrency(ctx.organization, input),
        smallBusiness: ctx.organization.smallBusiness,
        netCents: sum.netCents,
        vatCents: sum.vatCents,
        grossCents: sum.grossCents,
      })
      .returning();
    await tx.insert(invoiceItems).values(lineRows(ctx.organization.id, input.items).map((l) => ({ ...l, invoiceId: row.id })));
    await audit(tx, ctx, "invoice.draft", "invoice", row.id, { gross: sum.grossCents }, via);
    return row;
  });
}

export async function updateInvoiceDraft(ctx: Context, id: string, raw: InvoiceInput, via: Via = "web"): Promise<Invoice> {
  requirePermission(ctx.permissions, "invoices.create");
  const input = invoiceInput.parse(raw);
  checkRates(input.items, ctx.organization);
  const sum = totals(input.items, ctx.organization.smallBusiness);
  return withTenant(ctx.organization.id, async (tx) => {
    await draftOf(tx, id);
    await clientParty(tx, input.clientId);
    const [row] = await tx
      .update(invoices)
      .set({
        clientId: input.clientId,
        serviceDate: input.serviceDate,
        dueDate: input.dueDate,
        notes: input.notes,
        ...foreignCurrency(ctx.organization, input),
        smallBusiness: ctx.organization.smallBusiness,
        netCents: sum.netCents,
        vatCents: sum.vatCents,
        grossCents: sum.grossCents,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, id))
      .returning();
    await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    await tx.insert(invoiceItems).values(lineRows(ctx.organization.id, input.items).map((l) => ({ ...l, invoiceId: id })));
    await audit(tx, ctx, "invoice.update", "invoice", id, { gross: sum.grossCents }, via);
    return row;
  });
}

export async function deleteInvoiceDraft(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "invoices.create");
  await withTenant(ctx.organization.id, async (tx) => {
    await draftOf(tx, id);
    await tx.delete(invoices).where(eq(invoices.id, id));
    await audit(tx, ctx, "invoice.delete_draft", "invoice", id);
  });
}

/** An invoice draft with the order's lines. */
export async function invoiceFromOrder(ctx: Context, orderId: string, via: Via = "web"): Promise<Invoice> {
  requirePermission(ctx.permissions, "orders.read");
  const { order, items } = await withTenant(ctx.organization.id, async (tx) => {
    const [found] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!found) throw new NotFoundError();
    return {
      order: found,
      items: await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.position)),
    };
  });
  return createInvoiceDraft(
    ctx,
    { clientId: order.clientId, orderId: order.id, serviceDate: null, dueDate: null, notes: order.notes, items: asLines(items) },
    via,
  );
}

/** Freeze a draft: number, parties, dates. The database guards it after this. */
export async function issueInvoice(ctx: Context, id: string, via: Via = "web"): Promise<Invoice> {
  requirePermission(ctx.permissions, "invoices.issue");
  const missing = missingCompanyData(ctx.organization);
  if (missing.length) throw new InvoiceStateError("COMPANY_INCOMPLETE", missing);
  const org = ctx.organization;
  return withTenant(org.id, async (tx) => {
    const draft = await draftOf(tx, id);
    const issued = today(org.timezone);
    const year = Number(issued.slice(0, 4));
    const pattern = draft.kind === "CREDIT_NOTE" ? org.creditNoteNumberFormat : org.invoiceNumberFormat;
    const key = `${draft.kind === "CREDIT_NOTE" ? "credit" : "invoice"}-${year}`;
    const number = formatNumber(pattern, year, await nextNumber(tx, org.id, key));
    const [row] = await tx
      .update(invoices)
      .set({
        status: "ISSUED",
        number,
        issueDate: issued,
        serviceDate: draft.serviceDate ?? issued,
        dueDate: draft.dueDate ?? addDays(issued, org.paymentTermsDays),
        sellerSnapshot: { ...sellerOf(org), currency: draft.currency ?? org.currency },
        buyerSnapshot: await clientParty(tx, draft.clientId),
        issuedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, id))
      .returning();
    await tx.update(clients).set({ lastInteractionAt: new Date() }).where(eq(clients.id, draft.clientId));
    await audit(tx, ctx, "invoice.issue", "invoice", id, { number, gross: row.grossCents }, via);
    return row;
  });
}

export const paymentInput = z.object({
  amountCents: z.coerce.number().int().positive(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(PAYMENT_METHODS).default("TRANSFER"),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null),
});
export type PaymentInput = z.input<typeof paymentInput>;

/** Money received: the payment, the invoice's state, and the income in finance. */
export async function recordPayment(ctx: Context, id: string, raw: PaymentInput, via: Via = "web") {
  requirePermission(ctx.permissions, "finance.create");
  const input = paymentInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv) throw new NotFoundError();
    if (inv.kind !== "INVOICE" || !["ISSUED", "PARTIALLY_PAID"].includes(inv.status)) {
      throw new InvoiceStateError("NOT_OPEN");
    }
    const paid = inv.paidCents + input.amountCents;
    if (paid > inv.grossCents) throw new InvoiceStateError("OVERPAID");
    const [payment] = await tx
      .insert(payments)
      .values({ organizationId: ctx.organization.id, invoiceId: id, ...input })
      .returning();
    await tx
      .update(invoices)
      .set({ paidCents: paid, status: paid === inv.grossCents ? "PAID" : "PARTIALLY_PAID", updatedAt: new Date() })
      .where(eq(invoices.id, id));
    await tx.insert(transactions).values({
      organizationId: ctx.organization.id,
      type: "INCOME",
      amountCents: inBase(input.amountCents, inv),
      bookedOn: input.paidOn,
      category: "invoice",
      description: inv.number,
      method: input.method,
      invoiceId: id,
      paymentId: payment.id,
      clientId: inv.clientId,
    });
    await audit(tx, ctx, "invoice.payment", "invoice", id, { amount: input.amountCents }, via);
    return payment;
  });
}

/** Cancel an issued invoice with a credit note that mirrors it, issued at once. */
export async function cancelInvoice(ctx: Context, id: string, via: Via = "web"): Promise<Invoice> {
  requirePermission(ctx.permissions, "invoices.cancel");
  const missing = missingCompanyData(ctx.organization);
  if (missing.length) throw new InvoiceStateError("COMPANY_INCOMPLETE", missing);
  const draftId = await withTenant(ctx.organization.id, async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv) throw new NotFoundError();
    if (inv.kind !== "INVOICE" || !["ISSUED", "PARTIALLY_PAID", "PAID"].includes(inv.status)) {
      throw new InvoiceStateError("NOT_CANCELLABLE");
    }
    const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.position));
    const [note] = await tx
      .insert(invoices)
      .values({
        organizationId: ctx.organization.id,
        kind: "CREDIT_NOTE",
        clientId: inv.clientId,
        orderId: inv.orderId,
        correctsId: inv.id,
        serviceDate: inv.serviceDate,
        notes: inv.number,
        currency: inv.currency,
        exchangeRate: inv.exchangeRate,
        smallBusiness: inv.smallBusiness,
        netCents: -inv.netCents,
        vatCents: -inv.vatCents,
        grossCents: -inv.grossCents,
      })
      .returning();
    await tx.insert(invoiceItems).values(
      items.map((item) => ({
        organizationId: ctx.organization.id,
        invoiceId: note.id,
        position: item.position,
        productId: item.productId,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPriceCents: -item.unitPriceCents,
        discountPercent: item.discountPercent,
        vatRate: item.vatRate,
        netCents: -item.netCents,
      })),
    );
    await tx.update(invoices).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(invoices.id, id));
    await audit(tx, ctx, "invoice.cancel", "invoice", id, { creditNote: note.id }, via);
    return note.id;
  });
  return issueInvoice(ctx, draftId, via);
}

export async function getInvoice(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "invoices.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!invoice) throw new NotFoundError();
    const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.position));
    const paid = await tx.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(asc(payments.paidOn));
    const [client] = await tx.select().from(clients).where(eq(clients.id, invoice.clientId)).limit(1);
    const related = await tx
      .select({ id: invoices.id, number: invoices.number, kind: invoices.kind })
      .from(invoices)
      .where(or(eq(invoices.correctsId, id), invoice.correctsId ? eq(invoices.id, invoice.correctsId) : sql`false`));
    return { invoice, items, payments: paid, client, clientName: client ? displayName(client) : "—", related };
  });
}

import type { InvoiceFilter } from "@/lib/domain";

export type { InvoiceFilter };

export async function listInvoices(
  ctx: Context,
  query: { q?: string; filter?: InvoiceFilter; clientId?: string; page?: number; pageSize?: number } = {},
) {
  requirePermission(ctx.permissions, "invoices.read");
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const filters: SQL[] = [];
  const now = today(ctx.organization.timezone);
  switch (query.filter) {
    case "DRAFT":
      filters.push(eq(invoices.status, "DRAFT"));
      break;
    case "OPEN":
      filters.push(inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID"]), eq(invoices.kind, "INVOICE"));
      break;
    case "OVERDUE":
      filters.push(inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID"]), eq(invoices.kind, "INVOICE"), lt(invoices.dueDate, now));
      break;
    case "PAID":
      filters.push(eq(invoices.status, "PAID"));
      break;
    case "CANCELLED":
      filters.push(eq(invoices.status, "CANCELLED"));
      break;
    case "CREDIT_NOTE":
      filters.push(eq(invoices.kind, "CREDIT_NOTE"));
      break;
  }
  if (query.clientId) filters.push(eq(invoices.clientId, query.clientId));
  const q = query.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    filters.push(or(ilike(invoices.number, like), ilike(clients.companyName, like), ilike(clients.lastName, like))!);
  }
  const where = filters.length ? and(...filters) : undefined;
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ invoice: invoices, client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName } })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(where)
      .orderBy(desc(invoices.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(where);
    return {
      rows: rows.map((r) => ({
        ...r.invoice,
        clientName: displayName(r.client),
        overdue:
          r.invoice.kind === "INVOICE" &&
          ["ISSUED", "PARTIALLY_PAID"].includes(r.invoice.status) &&
          !!r.invoice.dueDate &&
          r.invoice.dueDate < now,
      })),
      total,
      page,
      pageSize,
    };
  });
}

/** What the PDF shows: the frozen parties of an issued invoice, today's for a draft. */
export async function pdfData(ctx: Context, id: string) {
  const { invoice, items, related } = await getInvoice(ctx, id);
  const buyer =
    (invoice.buyerSnapshot as Party | null) ??
    (await withTenant(ctx.organization.id, (tx) => clientParty(tx, invoice.clientId)));
  const seller = (invoice.sellerSnapshot as Seller | null) ?? { ...sellerOf(ctx.organization), currency: invoice.currency ?? ctx.organization.currency };
  const corrects = invoice.correctsId ? related.find((r) => r.id === invoice.correctsId)?.number ?? null : null;
  return { invoice, items, seller, buyer, corrects };
}
