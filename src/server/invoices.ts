/**
 * Invoices and credit notes.
 *
 * A **draft** may change freely and has no number. **Issuing** freezes it:
 * the next number of the year (no gaps — taken in the same transaction), the
 * seller's and the buyer's data as they are today, the issue and due date.
 * From then on the database itself (db/rls.sql, invoices_guard) refuses any
 * change to its figures, lines or parties; only payments move its state.
 * A wrong issued invoice is **corrected by a credit note**: all of it
 * (cancelling) or some of its lines — never edited, never deleted.
 *
 * How a sale is taxed comes from the invoice, within what the company's status
 * allows (src/lib/invoicing.ts); nothing assumes a rate. Issuing refuses what
 * § 14 UStG asks for and is missing. This follows those rules; whether a
 * company applies the right ones stays its own or its tax adviser's call.
 */
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/tenant";
import { clients, invoiceItems, invoices, invoiceTemplates, orderItems, orders, payments, transactions } from "@/db/schema";
import { audit, type Via } from "./audit";
import { displayName, NotFoundError } from "./clients";
import type { Context, Organization } from "./context";
import { addDays, checkRates, lineNet, linesInput, today, totals, type Line } from "./money";
import { nextDocumentNumber } from "./numbers";
import { asLines, lineRows } from "./orders";
import { requirePermission } from "./permissions";
import { LOCALES } from "@/i18n";
import { countryProfile } from "@/lib/countries";
import { PAYMENT_METHODS, type InvoiceSort } from "@/lib/domain";
import { availableTreatments, DEFAULT_STYLE, shownStatus, styleOf, TAX_TREATMENTS, taxFree, treatmentProblems, type InvoiceStyle, type TaxTreatment } from "@/lib/invoicing";

export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;

export class InvoiceStateError extends Error {
  constructor(
    public readonly code: "NOT_DRAFT" | "NOT_OPEN" | "OVERPAID" | "COMPANY_INCOMPLETE" | "CLIENT_INCOMPLETE" | "TAX_TREATMENT" | "NOT_CANCELLABLE" | "NOT_CREDITABLE" | "OVER_CREDITED",
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

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const invoiceInput = z
  .object({
    clientId: z.string().uuid(),
    orderId: z.string().uuid().nullish(),
    title: text(200),
    /** The date on the invoice; left out: the day it is issued. */
    invoiceDate: isoDate,
    serviceDate: isoDate,
    serviceEndDate: isoDate,
    dueDate: isoDate,
    notes: text(5000),
    items: linesInput,
    /** Another currency than the company's, with its rate; left out: the company's. */
    currency: z.string().trim().toUpperCase().length(3).nullish().transform((v) => v || null),
    exchangeRate: z.coerce.number().positive().max(1_000_000).nullish().transform((v) => v || null),
    /** Left out: what the company's status suggests first. */
    taxTreatment: z.enum(TAX_TREATMENTS).nullish(),
    exemptionReason: text(300),
    language: z.enum(LOCALES).nullish(),
    templateId: z.string().uuid().nullish(),
    /** Chosen once by the form: sent twice, it stays one invoice. */
    requestId: z.string().trim().min(8).max(64).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.invoiceDate && v.dueDate && v.dueDate < v.invoiceDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "before" });
    if (v.serviceDate && v.serviceEndDate && v.serviceEndDate < v.serviceDate) ctx.addIssue({ code: "custom", path: ["serviceEndDate"], message: "before" });
  });
export type InvoiceInput = z.input<typeof invoiceInput>;
type ParsedInvoice = z.output<typeof invoiceInput>;

/** How this invoice is taxed, within what the company may do. */
function taxOf(org: Organization, input: ParsedInvoice) {
  const allowed = availableTreatments(org.country, org.smallBusiness);
  const taxTreatment: TaxTreatment = input.taxTreatment ?? allowed[0];
  if (!allowed.includes(taxTreatment)) throw new z.ZodError([{ code: "custom", path: ["taxTreatment"], message: "treatment" }]);
  const needsReason = taxTreatment === "EXEMPT" || taxTreatment === "NOT_TAXABLE";
  return { taxTreatment, smallBusiness: taxTreatment === "SMALL_BUSINESS", exemptionReason: needsReason ? input.exemptionReason : null };
}

/** Lines as they are stored: under a tax-free treatment no line carries a rate. */
function taxedLines(org: Organization, input: ParsedInvoice, taxTreatment: TaxTreatment): Line[] {
  const lines = taxFree(taxTreatment) ? input.items.map((l) => ({ ...l, vatRate: 0 })) : input.items;
  checkRates(lines, org);
  return lines;
}

/** The chosen template, else the company's default; none stored: null. */
async function templateOf(tx: Tx, id: string | null | undefined) {
  if (id) {
    const [row] = await tx.select().from(invoiceTemplates).where(eq(invoiceTemplates.id, id)).limit(1);
    if (!row) throw new NotFoundError();
    return row;
  }
  const [row] = await tx.select().from(invoiceTemplates).where(eq(invoiceTemplates.isDefault, true)).limit(1);
  return row ?? null;
}

async function styleFor(tx: Tx, id: string | null): Promise<InvoiceStyle> {
  const [row] = id ? await tx.select().from(invoiceTemplates).where(eq(invoiceTemplates.id, id)).limit(1) : [];
  return row ? styleOf(row) : DEFAULT_STYLE;
}

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
  /** For e-invoices; missing in snapshots issued before they were kept. */
  email?: string | null;
  buyerReference?: string | null;
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

/** Up to this gross amount a German invoice may do without the buyer's address (§ 33 UStDV). */
const SMALL_AMOUNT_CENTS = 250_00;

/** What a German invoice must name about the buyer (§ 14 Abs. 4 Nr. 1 UStG). */
export function missingBuyerData(org: Pick<Organization, "country">, buyer: Pick<Party, "street" | "postalCode" | "city">, grossCents: number): string[] {
  if (org.country !== "DE" || grossCents <= SMALL_AMOUNT_CENTS) return [];
  return (["street", "postalCode", "city"] as const).filter((field) => !buyer[field]);
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

function organizationLocale(org: Organization) {
  return (LOCALES as readonly string[]).includes(org.locale) ? org.locale : "de";
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
    email: c.email,
    buyerReference: c.buyerReference,
  };
}

async function draftOf(tx: Tx, id: string): Promise<Invoice> {
  // Locked: of two people issuing the same draft, the second finds it issued.
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1).for("update");
  if (!row) throw new NotFoundError();
  if (row.status !== "DRAFT") throw new InvoiceStateError("NOT_DRAFT");
  return row;
}

export async function createInvoiceDraft(ctx: Context, raw: InvoiceInput, via: Via = "web"): Promise<Invoice> {
  requirePermission(ctx.permissions, "invoices.create");
  const input = invoiceInput.parse(raw);
  const tax = taxOf(ctx.organization, input);
  const lines = taxedLines(ctx.organization, input, tax.taxTreatment);
  const sum = totals(lines, tax.smallBusiness);
  return withTenant(ctx.organization.id, async (tx) => {
    const again = () => tx.select().from(invoices).where(eq(invoices.requestId, input.requestId!)).limit(1);
    if (input.requestId) {
      const [known] = await again();
      if (known) return known;
    }
    await clientParty(tx, input.clientId);
    const template = await templateOf(tx, input.templateId);
    const [row] = await tx
      .insert(invoices)
      .values({
        organizationId: ctx.organization.id,
        clientId: input.clientId,
        orderId: input.orderId ?? null,
        title: input.title,
        issueDate: input.invoiceDate,
        serviceDate: input.serviceDate,
        serviceEndDate: input.serviceEndDate,
        dueDate: input.dueDate,
        notes: input.notes,
        language: input.language ?? template?.language ?? organizationLocale(ctx.organization),
        templateId: template?.id ?? null,
        requestId: input.requestId ?? null,
        ...foreignCurrency(ctx.organization, input),
        ...tax,
        netCents: sum.netCents,
        vatCents: sum.vatCents,
        grossCents: sum.grossCents,
      })
      .onConflictDoNothing({ target: [invoices.organizationId, invoices.requestId] })
      .returning();
    // Lost the race against the same request: the other one's invoice is the one.
    if (!row) return (await again())[0];
    await tx.insert(invoiceItems).values(lineRows(ctx.organization.id, lines).map((l) => ({ ...l, invoiceId: row.id })));
    await audit(tx, ctx, "invoice.draft", "invoice", row.id, { gross: sum.grossCents }, via);
    return row;
  });
}

export async function updateInvoiceDraft(ctx: Context, id: string, raw: InvoiceInput, via: Via = "web"): Promise<Invoice> {
  requirePermission(ctx.permissions, "invoices.create");
  const input = invoiceInput.parse(raw);
  const tax = taxOf(ctx.organization, input);
  const lines = taxedLines(ctx.organization, input, tax.taxTreatment);
  const sum = totals(lines, tax.smallBusiness);
  return withTenant(ctx.organization.id, async (tx) => {
    const draft = await draftOf(tx, id);
    await clientParty(tx, input.clientId);
    // Left out (the API): stays. Empty: back to the company's default.
    const template = await templateOf(tx, input.templateId === undefined ? draft.templateId : input.templateId);
    const [row] = await tx
      .update(invoices)
      .set({
        clientId: input.clientId,
        title: input.title,
        issueDate: input.invoiceDate,
        serviceDate: input.serviceDate,
        serviceEndDate: input.serviceEndDate,
        dueDate: input.dueDate,
        notes: input.notes,
        language: input.language ?? draft.language,
        templateId: template?.id ?? null,
        ...foreignCurrency(ctx.organization, input),
        ...tax,
        netCents: sum.netCents,
        vatCents: sum.vatCents,
        grossCents: sum.grossCents,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, id))
      .returning();
    await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    await tx.insert(invoiceItems).values(lineRows(ctx.organization.id, lines).map((l) => ({ ...l, invoiceId: id })));
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

/** Inside a transaction, with the draft locked: checks it, numbers it, freezes it. */
async function issueDraft(tx: Tx, ctx: Context, draft: Invoice, via: Via): Promise<Invoice> {
  const org = ctx.organization;
  const missing = missingCompanyData(org);
  if (missing.length) throw new InvoiceStateError("COMPANY_INCOMPLETE", missing);
  const buyer = await clientParty(tx, draft.clientId);
  const credit = draft.kind === "CREDIT_NOTE";
  if (!credit) {
    if (!availableTreatments(org.country, org.smallBusiness).includes(draft.taxTreatment)) throw new InvoiceStateError("TAX_TREATMENT", ["treatment"]);
    const problems = treatmentProblems(draft.taxTreatment, draft.exemptionReason, { seller: org, buyer });
    if (problems.length) throw new InvoiceStateError("TAX_TREATMENT", problems);
    const incomplete = missingBuyerData(org, buyer, draft.grossCents);
    if (incomplete.length) throw new InvoiceStateError("CLIENT_INCOMPLETE", incomplete);
  }
  const issued = draft.issueDate ?? today(org.timezone);
  const number = await nextDocumentNumber(tx, org.id, credit ? "credit" : "invoice", credit ? org.creditNoteNumberFormat : org.invoiceNumberFormat, issued);
  const [row] = await tx
    .update(invoices)
    .set({
      status: "ISSUED",
      number,
      issueDate: issued,
      serviceDate: draft.serviceDate ?? issued,
      dueDate: draft.dueDate ?? addDays(issued, org.paymentTermsDays),
      sellerSnapshot: { ...sellerOf(org), currency: draft.currency ?? org.currency },
      buyerSnapshot: buyer,
      templateSnapshot: await styleFor(tx, draft.templateId),
      issuedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, draft.id))
    .returning();
  await tx.update(clients).set({ lastInteractionAt: new Date() }).where(eq(clients.id, draft.clientId));
  await audit(tx, ctx, "invoice.issue", "invoice", draft.id, { number, gross: row.grossCents }, via);
  return row;
}

/** The PDF of an issued document goes into the archive at once; failing here only delays that. */
async function archive(ctx: Context, id: string): Promise<void> {
  const { keepInvoiceFile } = await import("./invoice-files");
  await keepInvoiceFile(ctx, id, "PDF").catch((e) => console.error("invoice: PDF not archived", id, e instanceof Error ? e.message : e));
}

/** Freeze a draft: number, parties, dates, look. The database guards it after this. */
export async function issueInvoice(ctx: Context, id: string, via: Via = "web"): Promise<Invoice> {
  requirePermission(ctx.permissions, "invoices.issue");
  const row = await withTenant(ctx.organization.id, async (tx) => issueDraft(tx, ctx, await draftOf(tx, id), via));
  await archive(ctx, id);
  return row;
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
    const settled = paid + inv.creditedCents;
    if (settled > inv.grossCents) throw new InvoiceStateError("OVERPAID");
    const [payment] = await tx
      .insert(payments)
      .values({ organizationId: ctx.organization.id, invoiceId: id, ...input })
      .returning();
    await tx
      .update(invoices)
      .set({ paidCents: paid, status: settled === inv.grossCents ? "PAID" : "PARTIALLY_PAID", updatedAt: new Date() })
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

/** A credit note in the making: the invoice's terms with the given sums, still a draft. */
async function creditDraft(tx: Tx, ctx: Context, inv: Invoice, sum: { netCents: number; vatCents: number; grossCents: number }, reason: string | null) {
  const [note] = await tx
    .insert(invoices)
    .values({
      organizationId: ctx.organization.id,
      kind: "CREDIT_NOTE",
      clientId: inv.clientId,
      orderId: inv.orderId,
      correctsId: inv.id,
      title: inv.title,
      serviceDate: inv.serviceDate,
      serviceEndDate: inv.serviceEndDate,
      notes: reason,
      language: inv.language,
      taxTreatment: inv.taxTreatment,
      exemptionReason: inv.exemptionReason,
      templateId: inv.templateId,
      currency: inv.currency,
      exchangeRate: inv.exchangeRate,
      smallBusiness: inv.smallBusiness,
      netCents: -sum.netCents,
      vatCents: -sum.vatCents,
      grossCents: -sum.grossCents,
    })
    .returning();
  return note;
}

async function lockedForCredit(tx: Tx, id: string, code: "NOT_CANCELLABLE" | "NOT_CREDITABLE"): Promise<Invoice> {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1).for("update");
  if (!inv) throw new NotFoundError();
  if (inv.kind !== "INVOICE" || !["ISSUED", "PARTIALLY_PAID", "PAID"].includes(inv.status)) throw new InvoiceStateError(code);
  return inv;
}

const reasonInput = z.object({ reason: text(500) });

/** Cancel an issued invoice with a credit note that mirrors it, issued in the same step. */
export async function cancelInvoice(ctx: Context, id: string, via: Via = "web", raw: z.input<typeof reasonInput> = {}): Promise<Invoice> {
  requirePermission(ctx.permissions, "invoices.cancel");
  const { reason } = reasonInput.parse(raw);
  const note = await withTenant(ctx.organization.id, async (tx) => {
    const inv = await lockedForCredit(tx, id, "NOT_CANCELLABLE");
    // Part of it is already taken back: the rest goes by a credit note of its own.
    if (inv.creditedCents) throw new InvoiceStateError("NOT_CANCELLABLE");
    const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.position));
    const draft = await creditDraft(tx, ctx, inv, inv, reason);
    await tx.insert(invoiceItems).values(
      items.map((item) => ({
        organizationId: ctx.organization.id,
        invoiceId: draft.id,
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
    await tx.update(invoices).set({ status: "CANCELLED", creditedCents: inv.grossCents, updatedAt: new Date() }).where(eq(invoices.id, id));
    await audit(tx, ctx, "invoice.cancel", "invoice", id, { creditNote: draft.id, reason }, via);
    return issueDraft(tx, ctx, draft, via);
  });
  await archive(ctx, note.id);
  return note;
}

export const creditNoteInput = z.object({
  reason: text(500),
  /** Which lines, how many of each. */
  lines: z
    .array(z.object({ itemId: z.string().uuid(), quantity: z.coerce.number().positive().max(1_000_000) }))
    .min(1)
    .max(200),
});
export type CreditNoteInput = z.input<typeof creditNoteInput>;

/**
 * Takes back part of an issued invoice. It stays what it is, with less to pay;
 * once credit notes have taken all of it back it counts as credited.
 */
export async function createCreditNote(ctx: Context, id: string, raw: CreditNoteInput, via: Via = "web"): Promise<Invoice> {
  requirePermission(ctx.permissions, "invoices.cancel");
  const input = creditNoteInput.parse(raw);
  const note = await withTenant(ctx.organization.id, async (tx) => {
    const inv = await lockedForCredit(tx, id, "NOT_CREDITABLE");
    const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.position));
    const lines = input.lines.map((chosen) => {
      const item = items.find((i) => i.id === chosen.itemId);
      if (!item) throw new NotFoundError();
      if (chosen.quantity > Number(item.quantity)) throw new InvoiceStateError("OVER_CREDITED");
      return { item, line: { ...asLines([item])[0], quantity: chosen.quantity } };
    });
    const sum = totals(lines.map((l) => l.line), inv.smallBusiness);
    const credited = inv.creditedCents + sum.grossCents;
    if (sum.grossCents <= 0 || credited > inv.grossCents) throw new InvoiceStateError("OVER_CREDITED");
    const draft = await creditDraft(tx, ctx, inv, sum, input.reason);
    await tx.insert(invoiceItems).values(
      lines.map(({ item, line }, index) => ({
        organizationId: ctx.organization.id,
        invoiceId: draft.id,
        position: index + 1,
        productId: item.productId,
        description: item.description,
        quantity: String(line.quantity),
        unit: item.unit,
        unitPriceCents: -item.unitPriceCents,
        discountPercent: item.discountPercent,
        vatRate: item.vatRate,
        netCents: -lineNet(line),
      })),
    );
    const status = credited === inv.grossCents ? "CREDITED" : credited + inv.paidCents >= inv.grossCents ? "PAID" : inv.status;
    await tx.update(invoices).set({ status, creditedCents: credited, updatedAt: new Date() }).where(eq(invoices.id, id));
    await audit(tx, ctx, "invoice.credit", "invoice", id, { creditNote: draft.id, gross: sum.grossCents, reason: input.reason }, via);
    return issueDraft(tx, ctx, draft, via);
  });
  await archive(ctx, note.id);
  return note;
}

/** A new draft with the same customer, terms and lines; dates and number are its own. */
export async function duplicateInvoice(ctx: Context, id: string, via: Via = "web"): Promise<Invoice> {
  requirePermission(ctx.permissions, "invoices.create");
  return withTenant(ctx.organization.id, async (tx) => {
    const [source] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!source) throw new NotFoundError();
    if (source.kind !== "INVOICE") throw new InvoiceStateError("NOT_OPEN");
    const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.position));
    // The company's status may have changed since: what it cannot do any more falls back to what it does now.
    const allowed = availableTreatments(ctx.organization.country, ctx.organization.smallBusiness);
    const taxTreatment = allowed.includes(source.taxTreatment) ? source.taxTreatment : allowed[0];
    const smallBusiness = taxTreatment === "SMALL_BUSINESS";
    const sum = totals(asLines(items), smallBusiness);
    const [copy] = await tx
      .insert(invoices)
      .values({
        organizationId: ctx.organization.id,
        clientId: source.clientId,
        orderId: source.orderId,
        title: source.title,
        notes: source.notes,
        language: source.language,
        templateId: source.templateId,
        taxTreatment,
        exemptionReason: source.exemptionReason,
        smallBusiness,
        currency: source.currency,
        exchangeRate: source.exchangeRate,
        netCents: sum.netCents,
        vatCents: sum.vatCents,
        grossCents: sum.grossCents,
      })
      .returning();
    await tx.insert(invoiceItems).values(
      items.map((item) => ({
        organizationId: ctx.organization.id,
        invoiceId: copy.id,
        position: item.position,
        productId: item.productId,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPriceCents: item.unitPriceCents,
        discountPercent: item.discountPercent,
        vatRate: item.vatRate,
        netCents: item.netCents,
      })),
    );
    await audit(tx, ctx, "invoice.duplicate", "invoice", copy.id, { from: id }, via);
    return copy;
  });
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
      .select({ id: invoices.id, number: invoices.number, kind: invoices.kind, issueDate: invoices.issueDate })
      .from(invoices)
      .where(or(eq(invoices.correctsId, id), invoice.correctsId ? eq(invoices.id, invoice.correctsId) : sql`false`));
    return { invoice, items, payments: paid, client, clientName: client ? displayName(client) : "—", related };
  });
}

import type { InvoiceFilter } from "@/lib/domain";

export type { InvoiceFilter };

export async function listInvoices(
  ctx: Context,
  query: { q?: string; filter?: InvoiceFilter; clientId?: string; page?: number; pageSize?: number; sort?: InvoiceSort; dir?: "asc" | "desc" } = {},
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
    case "SENT":
      filters.push(eq(invoices.status, "ISSUED"), eq(invoices.kind, "INVOICE"), isNotNull(invoices.sentAt), or(isNull(invoices.dueDate), gte(invoices.dueDate, now))!);
      break;
    case "OVERDUE":
      filters.push(inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID"]), eq(invoices.kind, "INVOICE"), lt(invoices.dueDate, now));
      break;
    case "PARTIALLY_PAID":
    case "PAID":
    case "CANCELLED":
    case "CREDITED":
      filters.push(eq(invoices.status, query.filter));
      break;
    case "CREDIT_NOTE":
      filters.push(eq(invoices.kind, "CREDIT_NOTE"));
      break;
  }
  if (query.clientId) filters.push(eq(invoices.clientId, query.clientId));
  const q = query.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    filters.push(or(ilike(invoices.number, like), ilike(invoices.title, like), ilike(clients.companyName, like), ilike(clients.lastName, like), ilike(clients.firstName, like))!);
  }
  const where = filters.length ? and(...filters) : undefined;
  const columns: Record<InvoiceSort, SQL | typeof invoices.createdAt> = {
    number: sql`${invoices.number}`,
    client: sql`lower(coalesce(${clients.companyName}, ${clients.lastName}, ${clients.firstName}))`,
    issueDate: sql`${invoices.issueDate}`,
    dueDate: sql`${invoices.dueDate}`,
    total: sql`${invoices.grossCents}`,
    status: sql`${invoices.status}`,
    created: invoices.createdAt,
  };
  const column = columns[query.sort ?? "created"];
  // Drafts have no number or date yet: they stay at the end either way.
  const order = query.dir === "asc" ? sql`${column} asc nulls last` : sql`${column} desc nulls last`;
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ invoice: invoices, client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName, email: clients.email } })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(where)
      .orderBy(order, desc(invoices.createdAt))
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
        clientEmail: r.client.email,
        shown: shownStatus(r.invoice, now),
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

/** What the documents show: the frozen parties and look of an issued invoice, today's for a draft. */
export async function pdfData(ctx: Context, id: string) {
  const { invoice, items, related, client } = await getInvoice(ctx, id);
  const buyer =
    (invoice.buyerSnapshot as Party | null) ??
    (await withTenant(ctx.organization.id, (tx) => clientParty(tx, invoice.clientId)));
  const seller = (invoice.sellerSnapshot as Seller | null) ?? { ...sellerOf(ctx.organization), currency: invoice.currency ?? ctx.organization.currency };
  const corrected = invoice.correctsId ? related.find((r) => r.id === invoice.correctsId) : undefined;
  const style = invoice.templateSnapshot ? styleOf(invoice.templateSnapshot) : await withTenant(ctx.organization.id, (tx) => styleFor(tx, invoice.templateId));
  return { invoice, items, seller, buyer, client, style, corrects: corrected?.number ?? null, correctsDate: corrected?.issueDate ?? null };
}
