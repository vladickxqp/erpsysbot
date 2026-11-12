/**
 * The audit trail: every change, who made it and through which door
 * (web, telegram, ai). Written in the same transaction as the change, so a
 * change without its entry cannot exist.
 */
import { withTenant, type Tx } from "@/db/tenant";
import { auditLog } from "@/db/schema";
import type { Context } from "./context";

export type Via = "web" | "telegram" | "ai" | "shop" | "supplier";

/** A sign-in or sign-out in the company's trail (outside any business transaction). */
export async function auditAccess(userId: string, organizationId: string | null, action: "auth.login" | "auth.logout"): Promise<void> {
  if (!organizationId) return;
  await withTenant(organizationId, (tx) => tx.insert(auditLog).values({ organizationId, userId, action, entity: "user", entityId: userId }));
}

/** A file with company data left the app: who, what, for which period. */
export async function auditExport(ctx: Pick<Context, "user" | "organization">, action: string, data?: Record<string, unknown>): Promise<void> {
  await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, action, "export", null, data));
}

export async function audit(
  tx: Tx,
  ctx: Pick<Context, "user" | "organization">,
  action: string,
  entity: string,
  entityId: string | null,
  data?: Record<string, unknown>,
  via: Via = "web",
): Promise<void> {
  await tx.insert(auditLog).values({
    organizationId: ctx.organization.id,
    userId: ctx.user.userId,
    action,
    entity,
    entityId,
    via,
    data: data ?? null,
  });
}
