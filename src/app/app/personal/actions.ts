"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { addHabit, deleteGoal, deleteHabit, saveGoal, toggleHabit } from "@/server/personal";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export type PersonalResult = { ok?: boolean; error?: string };

async function guarded(work: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<unknown>): Promise<PersonalResult> {
  const ctx = await requireContext();
  try {
    await work(ctx);
    revalidatePath("/app/personal");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    if (e instanceof ZodError) return { error: "auth.check" };
    throw e;
  }
}

export async function saveGoalAction(id: string | null, input: { title: string; targetDate?: string | null; progress?: number }) {
  return guarded((ctx) => saveGoal(ctx, id, input));
}
export async function deleteGoalAction(id: string) {
  return guarded((ctx) => deleteGoal(ctx, id));
}
export async function addHabitAction(title: string) {
  return guarded((ctx) => addHabit(ctx, title));
}
export async function deleteHabitAction(id: string) {
  return guarded((ctx) => deleteHabit(ctx, id));
}
export async function toggleHabitAction(id: string, day: string) {
  return guarded((ctx) => toggleHabit(ctx, id, day));
}
