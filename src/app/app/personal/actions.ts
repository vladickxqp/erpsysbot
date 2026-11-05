"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { addHabit, addPersonalMoney, deleteGoal, deleteHabit, deletePersonalMoney, saveGoal, toggleHabit } from "@/server/personal";
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

export async function addMoneyAction(input: { kind: "IN" | "OUT"; amountCents: number; bookedOn: string; description: string }): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  try {
    await addPersonalMoney(ctx, input);
    revalidatePath("/app/personal");
    return { ok: true };
  } catch {
    return { error: "auth.check" };
  }
}

export async function deleteMoneyAction(id: string): Promise<void> {
  const ctx = await requireContext();
  await deletePersonalMoney(ctx, id);
  revalidatePath("/app/personal");
}
