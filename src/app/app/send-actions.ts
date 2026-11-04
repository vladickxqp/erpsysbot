"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { SendError, sendDocument, type DocumentKind } from "@/server/send";

export type SendResult = { ok?: boolean; error?: "forbidden" | "notFound" | "check" | "NO_MAIL" | "DRAFT" | "LIMIT" | "UNVERIFIED" | "failed" };

/** E-mails an invoice, quote or reminder with its PDF. */
export async function sendDocumentAction(kind: DocumentKind, id: string, to: string, message: string): Promise<SendResult> {
  const ctx = await requireContext();
  try {
    await sendDocument(ctx, kind, id, { to, message: message || undefined });
    revalidatePath(kind === "quote" ? "/app/quotes" : "/app/invoices", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    if (e instanceof NotFoundError) return { error: "notFound" };
    if (e instanceof ZodError) return { error: "check" };
    if (e instanceof SendError) return { error: e.code };
    console.error("mail: sending failed", e instanceof Error ? e.message : e);
    return { error: "failed" };
  }
}
