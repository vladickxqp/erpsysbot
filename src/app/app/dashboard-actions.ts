"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { createDashboard, deleteDashboard, saveDashboard } from "@/server/dashboards";
import { requireContext } from "@/server/request";

export type DashboardResult = { ok?: boolean; id?: string; error?: string };

function failure(e: unknown): DashboardResult {
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  throw e;
}

export async function saveDashboardAction(id: string, patch: { name?: string; widgets?: unknown }): Promise<DashboardResult> {
  const ctx = await requireContext();
  try {
    await saveDashboard(ctx, id, patch);
    revalidatePath("/app");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function createDashboardAction(name: string, template: "empty" | "default"): Promise<DashboardResult> {
  const ctx = await requireContext();
  try {
    const board = await createDashboard(ctx, name, template);
    revalidatePath("/app");
    return { ok: true, id: board.id };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteDashboardAction(id: string): Promise<DashboardResult> {
  const ctx = await requireContext();
  try {
    await deleteDashboard(ctx, id);
    revalidatePath("/app");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
