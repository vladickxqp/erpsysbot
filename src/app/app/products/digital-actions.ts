"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { addDigitalItems, deleteDigitalItem, DigitalError, revealDigitalItem, saveDigitalSettings } from "@/server/digital";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export type DigitalResult = { ok?: boolean; error?: string; added?: number; delivered?: number; content?: string };

function failure(e: unknown): DigitalResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  if (e instanceof DigitalError) return { error: `digital.error.${e.code}` };
  throw e;
}

async function run(work: () => Promise<DigitalResult | void>): Promise<DigitalResult> {
  try {
    const result = (await work()) ?? {};
    revalidatePath("/app/products", "layout");
    return { ok: true, ...result };
  } catch (e) {
    return failure(e);
  }
}

export async function saveDigitalSettingsAction(productId: string, input: { shared: boolean; note: string }): Promise<DigitalResult> {
  const ctx = await requireContext();
  return run(() => saveDigitalSettings(ctx, productId, input));
}

export async function addDigitalItemsAction(productId: string, variantId: string | null, text: string): Promise<DigitalResult> {
  const ctx = await requireContext();
  return run(() => addDigitalItems(ctx, productId, { variantId, text }));
}

export async function revealDigitalItemAction(id: string): Promise<DigitalResult> {
  const ctx = await requireContext();
  return run(async () => ({ content: await revealDigitalItem(ctx, id) }));
}

export async function deleteDigitalItemAction(id: string): Promise<DigitalResult> {
  const ctx = await requireContext();
  return run(() => deleteDigitalItem(ctx, id));
}
