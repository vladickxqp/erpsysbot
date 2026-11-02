"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import {
  cancelInvoice,
  createInvoiceDraft,
  deleteInvoiceDraft,
  InvoiceStateError,
  issueInvoice,
  recordPayment,
  updateInvoiceDraft,
} from "@/server/invoices";
import { parseMoney } from "@/server/money";
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

export async function saveDraftAction(id: string | null, payload: unknown): Promise<InvoiceResult> {
  const ctx = await requireContext();
  try {
    const row = id ? await updateInvoiceDraft(ctx, id, payload as never) : await createInvoiceDraft(ctx, payload as never);
    refresh();
    return { ok: true, id: row.id };
  } catch (e) {
    return failure(e);
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
