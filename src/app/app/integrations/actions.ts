"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { createApiKey, deleteApiKey } from "@/server/api-keys";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export async function createApiKeyAction(name: string, writable: boolean): Promise<{ token?: string; error?: string }> {
  const ctx = await requireContext();
  try {
    const token = await createApiKey(ctx, name, writable);
    revalidatePath("/app/integrations");
    return { token };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof ZodError) return { error: "auth.check" };
    throw e;
  }
}

export async function deleteApiKeyAction(id: string): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  try {
    await deleteApiKey(ctx, id);
    revalidatePath("/app/integrations");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    throw e;
  }
}
