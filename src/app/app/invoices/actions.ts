"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import type { PaperData } from "@/components/app/invoice-paper";
import { styleOf } from "@/lib/invoicing";
import { clientCard, createClient, displayName, DuplicateClientError, getClient, NotFoundError, updateClientCard, type Client } from "@/server/clients";
import {
  cancelInvoice,
  createCreditNote,
  createInvoiceDraft,
  deleteInvoiceDraft,
  duplicateInvoice,
  getInvoice,
  InvoiceStateError,
  issueInvoice,
  pdfData,
  recordPayment,
  updateInvoiceDraft,
  type CreditNoteInput,
  type InvoiceInput,
} from "@/server/invoices";
import { parseMoney } from "@/server/money";
import { asLines } from "@/server/orders";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { createReminder, ReminderError } from "@/server/reminders";

export type InvoiceResult = {
  ok?: boolean;
  id?: string;
  error?: "forbidden" | "notFound" | "check" | "state";
  code?: InvoiceStateError["code"] | ReminderError["code"];
  missing?: string[];
};

function failure(e: unknown): InvoiceResult {
  if (e instanceof ForbiddenError) return { error: "forbidden" };
  if (e instanceof NotFoundError) return { error: "notFound" };
  if (e instanceof ZodError) return { error: "check" };
  if (e instanceof InvoiceStateError) return { error: "state", code: e.code, missing: e.missing };
  if (e instanceof ReminderError) return { error: "state", code: e.code };
  throw e;
}

const refresh = () => {
  revalidatePath("/app/invoices");
  revalidatePath("/app/finance");
  revalidatePath("/app");
};

/** Saves the draft and, when asked, issues it in the same go. A failed issue leaves the saved draft and says so. */
export async function saveInvoiceAction(id: string | null, payload: InvoiceInput, issue: boolean): Promise<InvoiceResult> {
  const ctx = await requireContext();
  let saved: string | undefined = id ?? undefined;
  try {
    const row = id ? await updateInvoiceDraft(ctx, id, payload) : await createInvoiceDraft(ctx, payload);
    saved = row.id;
    // The same request again: what it made is already issued.
    if (issue && row.status === "DRAFT") await issueInvoice(ctx, row.id);
    refresh();
    return { ok: true, id: row.id };
  } catch (e) {
    refresh();
    return { ...failure(e), id: saved };
  }
}

export type QuickClient = {
  client?: {
    id: string;
    name: string;
    number: number;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    email: string | null;
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string;
    vatId: string | null;
  };
  /** Already known: this is the one that was there. */
  existing?: boolean;
  error?: "forbidden" | "check";
};

const asOption = (c: Client): NonNullable<QuickClient["client"]> => ({
  id: c.id,
  name: displayName(c),
  number: c.number,
  firstName: c.firstName,
  lastName: c.lastName,
  companyName: c.companyName,
  email: c.email,
  street: c.street,
  postalCode: c.postalCode,
  city: c.city,
  country: c.country,
  vatId: c.vatId,
});

/** A customer made or completed from within the invoice form. */
export async function quickClientAction(id: string | null, raw: unknown): Promise<QuickClient> {
  const ctx = await requireContext();
  try {
    const input = clientCard.parse(raw);
    if (id) return { client: asOption(await updateClientCard(ctx, id, input)) };
    return { client: asOption(await createClient(ctx, { ...input, type: input.companyName ? "COMPANY" : "PERSON" })) };
  } catch (e) {
    if (e instanceof DuplicateClientError) return { client: asOption(await getClient(ctx, e.candidates[0].id)), existing: true };
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    if (e instanceof ZodError) return { error: "check" };
    throw e;
  }
}

export async function issueAction(id: string): Promise<InvoiceResult> {
  const ctx = await requireContext();
  try {
    await issueInvoice(ctx, id);
    refresh();
    return { ok: true, id };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteDraftAction(id: string): Promise<InvoiceResult> {
  const ctx = await requireContext();
  try {
    await deleteInvoiceDraft(ctx, id);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function paymentAction(id: string, amount: string, paidOn: string, method: string): Promise<InvoiceResult> {
  const ctx = await requireContext();
  const cents = parseMoney(amount);
  if (cents === null || cents <= 0) return { error: "check" };
  try {
    await recordPayment(ctx, id, { amountCents: cents, paidOn, method: method as never });
    refresh();
    return { ok: true, id };
  } catch (e) {
    return failure(e);
  }
}

export async function cancelAction(id: string): Promise<InvoiceResult> {
  const ctx = await requireContext();
  try {
    const note = await cancelInvoice(ctx, id);
    refresh();
    return { ok: true, id: note.id };
  } catch (e) {
    return failure(e);
  }
}

export async function duplicateAction(id: string): Promise<InvoiceResult> {
  const ctx = await requireContext();
  try {
    const copy = await duplicateInvoice(ctx, id);
    refresh();
    return { ok: true, id: copy.id };
  } catch (e) {
    return failure(e);
  }
}

export async function creditNoteAction(id: string, input: CreditNoteInput): Promise<InvoiceResult> {
  const ctx = await requireContext();
  try {
    const note = await createCreditNote(ctx, id, input);
    refresh();
    return { ok: true, id: note.id };
  } catch (e) {
    return failure(e);
  }
}

export type CreditLine = { id: string; description: string; quantity: number; unit: string; unitPriceCents: number; discountPercent: number; vatRate: number };

/** The lines a credit note can take back; null when the invoice cannot be read. */
export async function creditLinesAction(id: string) {
  const ctx = await requireContext();
  const found = await getInvoice(ctx, id).catch(() => null);
  if (!found) return null;
  const { invoice, items } = found;
  const lines: CreditLine[] = asLines(items).map((line, index) => ({ ...line, id: items[index].id, description: items[index].description }));
  return { lines, openCents: invoice.grossCents - invoice.creditedCents, currency: invoice.currency, smallBusiness: invoice.smallBusiness };
}

/** One invoice as paper, for the preview in the list; null when it cannot be read. */
export async function invoicePaperAction(id: string): Promise<PaperData | null> {
  const ctx = await requireContext();
  const data = await pdfData(ctx, id).catch(() => null);
  if (!data) return null;
  const { invoice, seller, buyer, items, style } = data;
  const credit = invoice.kind === "CREDIT_NOTE";
  return {
    kind: invoice.kind,
    number: invoice.number,
    title: invoice.title,
    issueDate: invoice.issueDate,
    serviceDate: invoice.serviceDate,
    serviceEndDate: invoice.serviceEndDate,
    dueDate: invoice.dueDate,
    notes: credit ? null : invoice.notes,
    language: invoice.language,
    treatment: invoice.taxTreatment,
    reason: invoice.exemptionReason,
    currency: invoice.currency ?? seller.currency ?? ctx.organization.currency,
    seller,
    buyer,
    lines: asLines(items),
    style: styleOf(style),
    logoId: ctx.organization.logoDocumentId,
  };
}

export async function reminderAction(invoiceId: string): Promise<InvoiceResult> {
  const ctx = await requireContext();
  try {
    const reminder = await createReminder(ctx, invoiceId);
    revalidatePath(`/app/invoices/${invoiceId}`);
    return { ok: true, id: reminder.id };
  } catch (e) {
    return failure(e);
  }
}
