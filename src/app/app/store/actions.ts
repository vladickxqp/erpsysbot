"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import type { Block, Pages } from "@/lib/store";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import {
  createStore,
  deleteStore,
  saveBasics,
  saveBlocks,
  saveDesign,
  savePages,
  savePayments,
  saveShippingOptions,
  setStoreStatus,
  StoreError,
  type BasicsInput,
} from "@/server/stores";

export type StoreResult = { ok?: boolean; id?: string; error?: string; failed?: string[] };

function failure(e: unknown): StoreResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  if (e instanceof StoreError) return { error: `store.error.${e.code}`, failed: e.failed };
  throw e;
}

async function run(work: () => Promise<StoreResult | void>): Promise<StoreResult> {
  try {
    const result = (await work()) ?? {};
    revalidatePath("/app/store", "layout");
    return { ok: true, ...result };
  } catch (e) {
    return failure(e);
  }
}

export async function createStoreAction(name: string): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(async () => ({ id: (await createStore(ctx, { name })).id }));
}

export async function saveBasicsAction(id: string, input: BasicsInput): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => saveBasics(ctx, id, input));
}

export async function saveDesignAction(id: string, input: { template: string; primary: string; accent: string; logoId: string | null; tagline: string }): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => saveDesign(ctx, id, input as Parameters<typeof saveDesign>[2]));
}

export async function saveBlocksAction(id: string, blocks: Block[]): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => saveBlocks(ctx, id, blocks));
}

export async function savePagesAction(id: string, pages: Pages): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => savePages(ctx, id, pages));
}

export async function saveShippingAction(id: string, options: { id?: string; name: string; priceCents: number; freeFromCents: number | null }[]): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => saveShippingOptions(ctx, id, options));
}

export async function savePaymentsAction(
  id: string,
  input: { bank: boolean; stripe: boolean; secretKey?: string; webhookSecret?: string; removeStripe?: boolean },
): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => savePayments(ctx, id, input));
}

export async function setStoreStatusAction(id: string, status: "PUBLISHED" | "UNPUBLISHED"): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => setStoreStatus(ctx, id, status));
}

export async function deleteStoreAction(id: string): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => deleteStore(ctx, id));
}
