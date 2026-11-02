"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { invitePlatform, PlatformError, setCompanyPlan, setSuspended, updatePlan, type planInput } from "@/server/platform";
import { publicBase, requireContext } from "@/server/request";
import type { z } from "zod";

type Result = { ok?: boolean; url?: string; error?: string };

async function admin<T>(work: (user: Awaited<ReturnType<typeof requireContext>>["user"]) => Promise<T>): Promise<Result & { value?: T }> {
  const ctx = await requireContext();
  try {
    const value = await work(ctx.user);
    revalidatePath("/app/admin");
    return { ok: true, value };
  } catch (e) {
    if (e instanceof PlatformError) return { error: "common.forbidden" };
    if (e instanceof ZodError) return { error: "auth.check" };
    throw e;
  }
}

export async function inviteCompanyAction(email: string): Promise<Result> {
  const result = await admin((user) => invitePlatform(user, email));
  return result.value ? { ok: true, url: `${await publicBase()}/register?invite=${result.value}` } : result;
}

export async function suspendAction(organizationId: string, suspended: boolean): Promise<Result> {
  return admin((user) => setSuspended(user, organizationId, suspended));
}

export async function companyPlanAction(organizationId: string, planId: string, status: "ACTIVE" | "TRIALING" | "CANCELED"): Promise<Result> {
  return admin((user) => setCompanyPlan(user, organizationId, planId, status));
}

export async function planAction(id: string, input: z.input<typeof planInput>): Promise<Result> {
  return admin((user) => updatePlan(user, id, input));
}
