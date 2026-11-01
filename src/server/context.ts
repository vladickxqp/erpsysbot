/**
 * Who is asking, for which company, with which rights.
 *
 * Built on every request from the session cookie and the database — never
 * from anything the browser claims. The company is the session's active one
 * if the user is still a member there, else their first membership.
 */
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
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
  return {
    user,
    organization: active.organization,
    role,
    permissions: permissionsFor(role, active.membership.permissions),
    companies: rows.map((r) => ({ id: r.organization.id, name: r.organization.name, role: r.membership.role as Role })),
  };
}
