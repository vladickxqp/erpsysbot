"use server";

import { revalidatePath } from "next/cache";
import { BankError, bookLine, matchInvoice, setIgnored } from "@/server/bank";
import { NotFoundError } from "@/server/clients";
import { InvoiceStateError } from "@/server/invoices";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export type BankResult = { ok?: boolean; error?: string };

function failure(e: unknown): BankResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof BankError) return { error: `bank.${e.code}` };
  if (e instanceof InvoiceStateError) return { error: e.code === "OVERPAID" ? "bank.OVERPAID" : "bank.NOT_OPEN" };
  throw e;
}

const refresh = () => {
  revalidatePath("/app/finance", "layout");
  revalidatePath("/app/invoices");
  revalidatePath("/app");
};

export async function matchAction(id: string, invoiceId: string): Promise<BankResult> {
  const ctx = await requireContext();
  try {
    await matchInvoice(ctx, id, invoiceId);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function bookAction(id: string, category: string | null): Promise<BankResult> {
  const ctx = await requireContext();
  try {
    await bookLine(ctx, id, category);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function ignoreAction(id: string, ignored: boolean): Promise<BankResult> {
  const ctx = await requireContext();
  try {
    await setIgnored(ctx, id, ignored);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
