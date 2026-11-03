"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { saveDatevSettings } from "@/server/datev";
import { createTransaction, deleteTransaction } from "@/server/finance";
import { parseMoney } from "@/server/money";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export type FinanceResult = { ok?: boolean; error?: "forbidden" | "notFound" | "check" };

export async function addTransactionAction(input: {
  type: string;
  amount: string;
  bookedOn: string;
  category: string;
  description: string;
  method: string;
}): Promise<FinanceResult> {
  const ctx = await requireContext();
  const cents = parseMoney(input.amount);
  if (cents === null) return { error: "check" };
  try {
    await createTransaction(ctx, { ...input, type: input.type as never, amountCents: cents });
    revalidatePath("/app/finance");
    revalidatePath("/app");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    if (e instanceof ZodError) return { error: "check" };
    throw e;
  }
}

export async function deleteTransactionAction(id: string): Promise<FinanceResult> {
  const ctx = await requireContext();
  try {
    await deleteTransaction(ctx, id);
    revalidatePath("/app/finance");
    revalidatePath("/app");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    if (e instanceof NotFoundError) return { error: "notFound" };
    throw e;
  }
}

export async function saveDatevAction(input: { consultant: string; client: string; chart: "SKR03" | "SKR04"; fiscalStartMonth: string }): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  try {
    await saveDatevSettings(ctx, input);
    revalidatePath("/app/finance");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof ZodError) return { error: "datev.invalid" };
    throw e;
  }
}
