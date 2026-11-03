"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { deleteRecurring, runRecurring, saveRecurring, setRecurringActive, type RecurringInput } from "@/server/recurring";
import { requireContext } from "@/server/request";

export type RecurringResult = { ok?: boolean; id?: string; error?: string; created?: number };

function failure(e: unknown): RecurringResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  throw e;
}

const refresh = () => {
  revalidatePath("/app/invoices", "layout");
  revalidatePath("/app");
};

export async function saveRecurringAction(id: string | null, input: RecurringInput): Promise<RecurringResult> {
  const ctx = await requireContext();
  try {
    const row = await saveRecurring(ctx, id, input);
    refresh();
    return { ok: true, id: row.id };
  } catch (e) {
    return failure(e);
  }
}

export async function toggleRecurringAction(id: string, active: boolean): Promise<RecurringResult> {
  const ctx = await requireContext();
  try {
    await setRecurringActive(ctx, id, active);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteRecurringAction(id: string): Promise<RecurringResult> {
  const ctx = await requireContext();
  try {
    await deleteRecurring(ctx, id);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Makes what is due today right now (instead of waiting for the server's clock). */
export async function runRecurringNowAction(): Promise<RecurringResult> {
  const ctx = await requireContext();
  try {
    if (!ctx.permissions.has("invoices.create")) return { error: "common.forbidden" };
    const result = await runRecurring(ctx);
    refresh();
    return { ok: true, created: result.created };
  } catch (e) {
    return failure(e);
  }
}
