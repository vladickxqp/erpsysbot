"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { SUPPLIER_ORDER_ACTIONS, type SupplierOrderAction } from "@/lib/dropship";
import { NotFoundError } from "@/server/clients";
import { acknowledgePrice, DropshipError, runSupplierAction, saveDropshipSettings, signingSecret, type DropshipInput, type SupplierActionInput } from "@/server/dropship";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { testSupplierLink } from "@/server/supplier-link";

export type DropshipResult = { ok?: boolean; error?: string; secret?: string; test?: { ok: boolean; status: number | null; error: string | null } };

function failure(e: unknown): DropshipResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  if (e instanceof DropshipError) return { error: `dropship.error.${e.code}` };
  throw e;
}

const refresh = () => {
  revalidatePath("/app/purchasing", "layout");
  revalidatePath("/app/orders", "layout");
  revalidatePath("/app/products", "layout");
  revalidatePath("/app");
};

async function run(work: () => Promise<DropshipResult | void>): Promise<DropshipResult> {
  try {
    const result = (await work()) ?? {};
    refresh();
    return { ok: true, ...result };
  } catch (e) {
    return failure(e);
  }
}

export async function saveDropshipAction(supplierId: string, input: DropshipInput): Promise<DropshipResult> {
  const ctx = await requireContext();
  return run(() => saveDropshipSettings(ctx, supplierId, input));
}

export async function signingSecretAction(supplierId: string, renew: boolean): Promise<DropshipResult> {
  const ctx = await requireContext();
  return run(async () => ({ secret: await signingSecret(ctx, supplierId, renew) }));
}

export async function testSupplierLinkAction(supplierId: string): Promise<DropshipResult> {
  const ctx = await requireContext();
  return run(async () => ({ test: await testSupplierLink(ctx, supplierId) }));
}

export async function supplierOrderStepAction(id: string, action: SupplierOrderAction, input: SupplierActionInput = {}): Promise<DropshipResult> {
  const ctx = await requireContext();
  if (!SUPPLIER_ORDER_ACTIONS.includes(action)) return { error: "auth.check" };
  return run(async () => {
    await runSupplierAction(ctx, id, action, input);
  });
}

export async function acknowledgePriceAction(offerId: string): Promise<DropshipResult> {
  const ctx = await requireContext();
  return run(() => acknowledgePrice(ctx, offerId));
}
