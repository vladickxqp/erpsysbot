"use server";

import { revalidatePath } from "next/cache";
import { NotFoundError } from "@/server/clients";
import { deleteDocument, setArchived } from "@/server/documents";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export async function archiveDocumentAction(id: string, archived: boolean): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  try {
    await setArchived(ctx, id, archived);
    revalidatePath("/app/documents");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    throw e;
  }
}

export async function deleteDocumentAction(id: string): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  try {
    await deleteDocument(ctx, id);
    revalidatePath("/app/documents");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    throw e;
  }
}
