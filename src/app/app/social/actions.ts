"use server";

import { revalidatePath } from "next/cache";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { addSocialAccount, refreshSocial, removeSocialAccount, SocialError } from "@/server/social";

export type SocialResult = { ok?: boolean; failed?: number; error?: string };

function failure(e: unknown): SocialResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof SocialError) return { error: `social.${e.code}` };
  throw e;
}

const refresh = () => {
  revalidatePath("/app/social");
  revalidatePath("/app/integrations");
  revalidatePath("/app");
};

export async function addSocialAction(provider: string, value: string): Promise<SocialResult> {
  const ctx = await requireContext();
  try {
    await addSocialAccount(ctx, provider, value);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function removeSocialAction(id: string): Promise<SocialResult> {
  const ctx = await requireContext();
  try {
    await removeSocialAccount(ctx, id);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function refreshSocialAction(): Promise<SocialResult> {
  const ctx = await requireContext();
  try {
    const failed = await refreshSocial(ctx);
    refresh();
    return { ok: true, failed };
  } catch (e) {
    return failure(e);
  }
}
