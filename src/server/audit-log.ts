/**
 * The audit trail to read: who changed what, when and through which door.
 * Owners and admins only (settings.manage); entries are never changed.
 */
import { and, count, desc, eq, like, type SQL } from "drizzle-orm";
import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

export const AUDIT_PAGE_SIZE = 50;

export async function listAudit(ctx: Context, query: { page?: number; entity?: string; userId?: string; via?: string } = {}) {
  requirePermission(ctx.permissions, "settings.manage");
  const filters: SQL[] = [];
  if (query.entity && /^[a-z_]+$/.test(query.entity)) filters.push(like(auditLog.action, `${query.entity}.%`));
  if (query.userId && /^[0-9a-f-]{36}$/i.test(query.userId)) filters.push(eq(auditLog.userId, query.userId));
  if (query.via === "web" || query.via === "telegram" || query.via === "ai" || query.via === "shop" || query.via === "supplier") filters.push(eq(auditLog.via, query.via));
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const where = filters.length ? and(...filters) : undefined;
  return withTenant(ctx.organization.id, async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(auditLog).where(where);
    const rows = await tx
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE);
    return { rows, total: Number(n), page, pages: Math.max(1, Math.ceil(Number(n) / AUDIT_PAGE_SIZE)) };
  });
}

/** A short line of what the entry's data says ("RE-2026-0001", "Müller GmbH"). */
export function auditSummary(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  for (const key of ["number", "title", "name", "email", "channel"]) if (typeof d[key] === "string" && d[key]) return String(d[key]).slice(0, 80);
  if (typeof d.from === "string" && typeof d.to === "string") return `${d.from} → ${d.to}`;
  return "";
}
