"use server";

import { BillingError, checkoutUrl, portalUrl } from "@/server/billing";
import { ForbiddenError } from "@/server/permissions";
import { publicBase, requireContext } from "@/server/request";

export async function checkoutAction(planId: string): Promise<{ url?: string; error?: string }> {
  const ctx = await requireContext();
  try {
    return { url: await checkoutUrl(ctx, planId, await publicBase()) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof BillingError) return { error: `billing.${e.code}` };
    console.error("stripe: checkout failed", e instanceof Error ? e.message : e);
    return { error: "common.error" };
  }
}

export async function portalAction(): Promise<{ url?: string; error?: string }> {
  const ctx = await requireContext();
  try {
    return { url: await portalUrl(ctx, await publicBase()) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof BillingError) return { error: `billing.${e.code}` };
    console.error("stripe: portal failed", e instanceof Error ? e.message : e);
    return { error: "common.error" };
  }
}
