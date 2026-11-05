"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { cancelAbsence, decideAbsence, HrError, requestAbsence, saveProfile } from "@/server/hr";
import { today } from "@/server/money";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

type Result = { ok?: boolean; error?: string };

async function guarded(work: () => Promise<unknown>): Promise<Result> {
  try {
    await work();
    revalidatePath("/app/hr");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    if (e instanceof ZodError) return { error: "auth.check" };
    if (e instanceof HrError) return { error: `hub.hr.${e.code}` };
    throw e;
  }
}

export async function requestAbsenceAction(input: { kind: "VACATION" | "SICK" | "OTHER"; startDate: string; endDate: string; note: string }): Promise<Result> {
  const ctx = await requireContext();
  return guarded(() => requestAbsence(ctx, input));
}

export async function decideAbsenceAction(id: string, approve: boolean): Promise<Result> {
  const ctx = await requireContext();
  return guarded(() => decideAbsence(ctx, id, approve));
}

export async function cancelAbsenceAction(id: string): Promise<Result> {
  const ctx = await requireContext();
  return guarded(() => cancelAbsence(ctx, id, today(ctx.organization.timezone)));
}

export async function saveProfileAction(userId: string, input: { position: string; hireDate: string; vacationDays: number; phone: string; emergencyContact: string; notes: string }): Promise<Result> {
  const ctx = await requireContext();
  return guarded(() => saveProfile(ctx, userId, { ...input, hireDate: input.hireDate || null }));
}
