"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import type { InvoiceFileKind } from "@/lib/invoicing";
import { NotFoundError } from "@/server/clients";
import { InvoiceFileError } from "@/server/invoice-files";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { SendError, sendDocument, sendInvoice, type DocumentKind } from "@/server/send";

export type SendResult = {
  ok?: boolean;
  error?: "forbidden" | "notFound" | "check" | "NO_MAIL" | "DRAFT" | "LIMIT" | "UNVERIFIED" | "REFUSED" | "NOT_READY" | "DAMAGED" | "failed";
  missing?: string[];
};

function failure(e: unknown): SendResult {
  if (e instanceof ForbiddenError) return { error: "forbidden" };
  if (e instanceof NotFoundError) return { error: "notFound" };
  if (e instanceof ZodError) return { error: "check" };
  if (e instanceof SendError) return { error: e.code };
  if (e instanceof InvoiceFileError) return { error: e.code === "DRAFT" ? "DRAFT" : e.code, missing: e.missing };
  console.error("mail: sending failed", e instanceof Error ? e.message : e);
  return { error: "failed" };
}

/** E-mails an invoice, quote or reminder with its PDF. */
export async function sendDocumentAction(kind: DocumentKind, id: string, to: string, message: string): Promise<SendResult> {
  const ctx = await requireContext();
  try {
    await sendDocument(ctx, kind, id, { to, message: message || undefined });
    revalidatePath(kind === "quote" ? "/app/quotes" : "/app/invoices", "layout");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** E-mails an invoice in the chosen format; the attempt lands in its history either way. */
export async function sendInvoiceAction(id: string, to: string, message: string, format: InvoiceFileKind): Promise<SendResult> {
  const ctx = await requireContext();
  try {
    await sendInvoice(ctx, id, { to, message: message || undefined, format });
    revalidatePath("/app/invoices", "layout");
    return { ok: true };
  } catch (e) {
    // A refused mail is in the history now: the page should show it.
    revalidatePath("/app/invoices", "layout");
    return failure(e);
  }
}
