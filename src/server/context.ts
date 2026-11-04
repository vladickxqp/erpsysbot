/**
 * Who is asking, for which company, with which rights.
 *
 * Built on every request from the session cookie and the database — never
 * from anything the browser claims. The company is the session's active one
 * if the user is still a member there, else their first membership.
 */
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cleanModules, withDependents, type AppModule } from "@/lib/modules";
import { memberships, organizations } from "@/db/schema";
import { entitlementsOf, PLAN_MODULE_OF } from "./billing";
import { permissionsFor, type Permission, type Role } from "./permissions";
import type { SessionUser } from "./auth/sessions";

export type Organization = typeof organizations.$inferSelect;

export type Context = {
  user: SessionUser;
  organization: Organization;
  role: Role;
  permissions: Set<Permission>;
  companies: { id: string; name: string; role: Role }[];
  /** Switched off for the whole company. */
  disabledModules: Set<AppModule>;
  /** Kept out of this person's own menu. */
  hiddenModules: Set<AppModule>;
};

/**
 * Who owns which permissions: a permission goes away once every module using
 * it is switched off, so a switched-off module is closed in server actions
 * and routes too, not only in the menu.
 */
const PERMISSION_MODULES: [Permission[], AppModule[]][] = [
  [["clients.read", "clients.create", "clients.update", "clients.delete"], ["crm"]],
  [["orders.read"], ["orders", "quotes", "products", "inventory"]],
  [["orders.create", "orders.update", "orders.delete"], ["orders", "quotes"]],
  [["products.manage"], ["products"]],
  [["inventory.manage"], ["inventory"]],
  [["invoices.read", "invoices.create", "invoices.issue", "invoices.cancel"], ["invoices"]],
  [["finance.read", "finance.create", "finance.export"], ["finance"]],
  [["calendar.read", "calendar.manage"], ["calendar"]],
  [["tasks.read", "tasks.manage"], ["tasks"]],
  [["time.read", "time.manage"], ["time"]],
  [["documents.read", "documents.manage"], ["documents", "media"]],
  [["content.manage", "content.publish"], ["content"]],
  [["content.read"], ["content", "social"]],
  [["automation.manage"], ["automation"]],
  [["ai.use"], ["assistant"]],
];

export async function contextFor(user: SessionUser): Promise<Context | null> {
  const rows = await getDb()
    .select({ membership: memberships, organization: organizations })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, user.userId))
    .orderBy(asc(memberships.createdAt));
  if (!rows.length) return null;
  const active = rows.find((r) => r.organization.id === user.activeOrganizationId) ?? rows[0];
  const role = active.membership.role as Role;
  const disabledModules = new Set(withDependents(active.organization.disabledModules));
  const permissions = permissionsFor(role, active.membership.permissions);
  for (const [granted, modules] of PERMISSION_MODULES) {
    if (modules.every((m) => disabledModules.has(m))) for (const p of granted) permissions.delete(p);
  }
  // What the plan does not include (or everything, once the subscription ended) is not allowed —
  // in every action and route, not only on the pages. Billing and settings stay reachable.
  const ent = await entitlementsOf(active.organization.id);
  if (!ent.unlimited) {
    for (const p of [...permissions]) {
      if (p === "billing.manage" || p === "settings.manage") continue;
      const planModule = PLAN_MODULE_OF[p.split(".")[0]];
      if (!ent.active || (planModule && !ent.modules.has(planModule))) permissions.delete(p);
    }
  }
  return {
    user,
    organization: active.organization,
    role,
    permissions,
    disabledModules,
    hiddenModules: new Set(cleanModules(active.membership.hiddenModules)),
    companies: rows.map((r) => ({ id: r.organization.id, name: r.organization.name, role: r.membership.role as Role })),
  };
}
