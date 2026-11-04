"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { parseMoney } from "@/server/money";
import { ForbiddenError } from "@/server/permissions";
import { addProjectCost } from "@/server/project-hub";
import { requireContext } from "@/server/request";

export async function addProjectCostAction(projectId: string, amount: string, bookedOn: string, what: string): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  try {
    const cents = parseMoney(amount);
    if (!cents || cents <= 0) return { error: "auth.check" };
    await addProjectCost(ctx, projectId, cents, bookedOn, what);
    revalidatePath(`/app/tasks/projects/${projectId}`);
    revalidatePath("/app/finance");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    if (e instanceof ZodError) return { error: "auth.check" };
    throw e;
  }
}
