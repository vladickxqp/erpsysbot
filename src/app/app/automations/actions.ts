"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { deleteAutomation, saveAutomation, type AutomationInput } from "@/server/automations";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export async function saveAutomationAction(id: string | null, input: AutomationInput): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  try {
    await saveAutomation(ctx, id, input);
    revalidatePath("/app/automations");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    if (e instanceof ZodError) return { error: "auth.check" };
    throw e;
  }
}

export async function deleteAutomationAction(id: string): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  try {
    await deleteAutomation(ctx, id);
    revalidatePath("/app/automations");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    throw e;
  }
}
