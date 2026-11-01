/**
 * The audit trail: every change, who made it and through which door
 * (web, telegram, ai). Written in the same transaction as the change, so a
 * change without its entry cannot exist.
 */
import type { Tx } from "@/db/tenant";
import { auditLog } from "@/db/schema";
import type { Context } from "./context";

export type Via = "web" | "telegram" | "ai";

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
