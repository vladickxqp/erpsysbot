"use server";

import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { publicBase, requireContext } from "@/server/request";
import { createShareLink, revokeShareLinks, ShareError, type ShareKind } from "@/server/share";

export async function revokeShareAction(kind: ShareKind, id: string): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  try {
    await revokeShareLinks(ctx, kind, id);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    throw e;
  }
}

export async function shareAction(kind: ShareKind, id: string): Promise<{ url?: string; error?: string }> {
  const ctx = await requireContext();
  try {
    return { url: `${await publicBase()}/p/${await createShareLink(ctx, kind, id)}` };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError || e instanceof ShareError) return { error: "common.error" };
    throw e;
  }
}
