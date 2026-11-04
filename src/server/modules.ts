/**
 * Which modules a company uses and which a person keeps in their menu.
 *
 * Switching a module off for the company needs settings.manage and hides it
 * from everyone; hiding it for oneself is everyone's own choice and only
 * changes their own menu.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { memberships, organizations } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { cleanModules, withDependents, type AppModule } from "@/lib/modules";
import { audit } from "./audit";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

export async function setCompanyModules(ctx: Context, disabled: readonly string[]): Promise<AppModule[]> {
  requirePermission(ctx.permissions, "settings.manage");
  const modules = withDependents(disabled);
  await getDb().update(organizations).set({ disabledModules: modules }).where(eq(organizations.id, ctx.organization.id));
  await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, "company.modules", "organization", ctx.organization.id, { disabled: modules }));
  return modules;
}

export async function setMyModules(ctx: Context, hidden: readonly string[]): Promise<AppModule[]> {
  const modules = cleanModules(hidden);
  await getDb()
    .update(memberships)
    .set({ hiddenModules: modules })
    .where(and(eq(memberships.organizationId, ctx.organization.id), eq(memberships.userId, ctx.user.userId)));
  return modules;
}

/** On for this person: switched on for the company and not hidden by them. */
export function moduleOn(ctx: Pick<Context, "disabledModules" | "hiddenModules">, module: AppModule): boolean {
  return !ctx.disabledModules.has(module) && !ctx.hiddenModules.has(module);
}
