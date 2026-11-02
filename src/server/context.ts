/**
 * Who is asking, for which company, with which rights.
 *
 * Built on every request from the session cookie and the database — never
 * from anything the browser claims. The company is the session's active one
 * if the user is still a member there, else their first membership.
 */
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cleanModules, type AppModule } from "@/lib/modules";
import { memberships, organizations } from "@/db/schema";
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

/** Permissions that belong to one module only, and go with it when it is switched off. */
const MODULE_PERMISSIONS: Partial<Record<AppModule, Permission[]>> = {
  content: ["content.manage", "content.publish"],
  automation: ["automation.manage"],
};

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
  const disabledModules = new Set(cleanModules(active.organization.disabledModules));
  const permissions = permissionsFor(role, active.membership.permissions);
  for (const m of disabledModules) for (const p of MODULE_PERMISSIONS[m] ?? []) permissions.delete(p);
  // Reading content serves the social channels too: it goes only when both are off.
  if (disabledModules.has("content") && disabledModules.has("social")) permissions.delete("content.read");
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
