"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { deleteDeal, moveDeal, saveDeal, type DealInput, type DealStage } from "@/server/deals";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export type DealResult = { ok?: boolean; error?: string };

function failure(e: unknown): DealResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  throw e;
}

const refresh = () => {
  revalidatePath("/app/pipeline");
  revalidatePath("/app/clients");
};

export async function saveDealAction(id: string | null, payload: DealInput): Promise<DealResult> {
  const ctx = await requireContext();
  try {
    await saveDeal(ctx, id, payload);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function moveDealAction(id: string, stage: DealStage): Promise<DealResult> {
  const ctx = await requireContext();
  try {
    await moveDeal(ctx, id, stage);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteDealAction(id: string): Promise<DealResult> {
  const ctx = await requireContext();
  try {
    await deleteDeal(ctx, id);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
