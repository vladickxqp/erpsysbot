"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { InventoryError, receivePurchaseOrder, savePurchaseOrder, saveSupplier, setPurchaseStatus, type PurchaseInput, type SupplierInput } from "@/server/inventory";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export type PurchaseResult = { ok?: boolean; error?: string };

function failure(e: unknown): PurchaseResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  if (e instanceof InventoryError) return { error: `inventory.${e.code}` };
  throw e;
}

const refresh = () => {
  revalidatePath("/app/purchasing");
  revalidatePath("/app/products");
};

const run = async (work: () => Promise<unknown>): Promise<PurchaseResult> => {
  try {
    await work();
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
};

export async function saveSupplierAction(id: string | null, input: SupplierInput): Promise<PurchaseResult> {
  const ctx = await requireContext();
  return run(() => saveSupplier(ctx, id, input));
}

export async function savePurchaseAction(id: string | null, input: PurchaseInput): Promise<PurchaseResult> {
  const ctx = await requireContext();
  return run(() => savePurchaseOrder(ctx, id, input));
}

export async function purchaseStatusAction(id: string, status: "ORDERED" | "CANCELLED"): Promise<PurchaseResult> {
  const ctx = await requireContext();
  return run(() => setPurchaseStatus(ctx, id, status));
}

export async function receivePurchaseAction(id: string): Promise<PurchaseResult> {
  const ctx = await requireContext();
  return run(() => receivePurchaseOrder(ctx, id));
}
