"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { createQuote, deleteQuote, quoteToInvoice, quoteToOrder, setQuoteStatus, updateQuote, type QuoteStatus } from "@/server/quotes";
import { requireContext } from "@/server/request";

export type QuoteResult = { ok?: boolean; id?: string; error?: "forbidden" | "notFound" | "check" | "state"; code?: string };

function failure(e: unknown): QuoteResult {
  if (e instanceof ForbiddenError) return { error: "forbidden" };
  if (e instanceof NotFoundError) return { error: "notFound" };
  if (e instanceof ZodError) return { error: "check" };
  const coded = e as { code?: unknown };
  if (typeof coded?.code === "string" && /^[A-Z_]+$/.test(coded.code)) return { error: "state", code: coded.code };
  throw e;
}

const refresh = () => {
  revalidatePath("/app/quotes", "layout");
  revalidatePath("/app");
};

export async function saveQuoteAction(id: string | null, payload: unknown): Promise<QuoteResult> {
  const ctx = await requireContext();
  try {
    const quote = id ? await updateQuote(ctx, id, payload as never) : await createQuote(ctx, payload as never);
    refresh();
    return { ok: true, id: quote.id };
  } catch (e) {
    return failure(e);
  }
}

export async function quoteStatusAction(id: string, status: QuoteStatus): Promise<QuoteResult> {
  const ctx = await requireContext();
  try {
    await setQuoteStatus(ctx, id, status);
    refresh();
    return { ok: true, id };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteQuoteAction(id: string): Promise<QuoteResult> {
  const ctx = await requireContext();
  try {
    await deleteQuote(ctx, id);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function quoteToOrderAction(id: string): Promise<QuoteResult> {
  const ctx = await requireContext();
  try {
    const order = await quoteToOrder(ctx, id);
    refresh();
    revalidatePath("/app/orders");
    return { ok: true, id: order.id };
  } catch (e) {
    return failure(e);
  }
}

export async function quoteToInvoiceAction(id: string): Promise<QuoteResult> {
  const ctx = await requireContext();
  try {
    const invoice = await quoteToInvoice(ctx, id);
    refresh();
    revalidatePath("/app/invoices");
    return { ok: true, id: invoice.id };
  } catch (e) {
    return failure(e);
  }
}
