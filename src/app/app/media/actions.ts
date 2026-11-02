"use server";

import { revalidatePath } from "next/cache";
import { NotFoundError } from "@/server/clients";
import { setCollection } from "@/server/documents";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export async function setCollectionAction(id: string, collection: string | null): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  try {
    await setCollection(ctx, id, collection);
    revalidatePath("/app/media");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    throw e;
  }
}
