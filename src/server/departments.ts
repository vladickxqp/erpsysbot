/**
 * Departments: the structure of a team. A person belongs to at most one; a
 * department may name its head. Rights stay with roles.
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { businessUnits, departments, memberships } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

export async function listDepartments(ctx: Context) {
  requirePermission(ctx.permissions, "employees.read");
  return withTenant(ctx.organization.id, (tx) => tx.select().from(departments).orderBy(asc(departments.name)));
}

export async function saveDepartment(ctx: Context, id: string | null, raw: { name: string; managerUserId?: string | null }) {
  requirePermission(ctx.permissions, "employees.manage");
  const name = z.string().trim().min(1).max(120).parse(raw.name);
  const managerUserId = z.string().uuid().nullish().parse(raw.managerUserId) ?? null;
  const row = await withTenant(ctx.organization.id, async (tx) => {
    if (id) {
      const [updated] = await tx.update(departments).set({ name, managerUserId }).where(eq(departments.id, id)).returning();
      if (!updated) throw new NotFoundError();
      return updated;
    }
    const [created] = await tx
      .insert(departments)
      .values({ organizationId: ctx.organization.id, name, managerUserId })
      .onConflictDoNothing()
      .returning();
    return created ?? null;
  });
  if (!row) throw new NotFoundError();
  return row;
}

export async function deleteDepartment(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "employees.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(departments).where(eq(departments.id, id)).returning({ name: departments.name });
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "team.department", "department", id, { name: row.name });
  });
  await getDb()
    .update(memberships)
    .set({ departmentId: null })
    .where(and(eq(memberships.organizationId, ctx.organization.id), eq(memberships.departmentId, id)));
}

export async function listUnits(ctx: Context) {
  requirePermission(ctx.permissions, "employees.read");
  return withTenant(ctx.organization.id, (tx) => tx.select().from(businessUnits).orderBy(asc(businessUnits.name)));
}

/** A larger part of the company, grouping departments. */
export async function saveUnit(ctx: Context, raw: string): Promise<void> {
  requirePermission(ctx.permissions, "employees.manage");
  const name = z.string().trim().min(1).max(120).parse(raw);
  await withTenant(ctx.organization.id, (tx) => tx.insert(businessUnits).values({ organizationId: ctx.organization.id, name }).onConflictDoNothing());
}

export async function deleteUnit(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "employees.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    await tx.update(departments).set({ unitId: null }).where(eq(departments.unitId, id));
    await tx.delete(businessUnits).where(eq(businessUnits.id, id));
  });
}

export async function assignUnit(ctx: Context, departmentId: string, unitId: string | null): Promise<void> {
  requirePermission(ctx.permissions, "employees.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    if (unitId && !(await tx.select({ id: businessUnits.id }).from(businessUnits).where(eq(businessUnits.id, unitId))).length) throw new NotFoundError();
    const [row] = await tx.update(departments).set({ unitId }).where(eq(departments.id, departmentId)).returning({ id: departments.id });
    if (!row) throw new NotFoundError();
  });
}

export async function assignDepartment(ctx: Context, userId: string, departmentId: string | null): Promise<void> {
  requirePermission(ctx.permissions, "employees.manage");
  if (departmentId) {
    const [found] = await withTenant(ctx.organization.id, (tx) => tx.select({ id: departments.id }).from(departments).where(eq(departments.id, departmentId)));
    if (!found) throw new NotFoundError();
  }
  const [row] = await getDb()
    .update(memberships)
    .set({ departmentId })
    .where(and(eq(memberships.organizationId, ctx.organization.id), eq(memberships.userId, userId)))
    .returning({ id: memberships.id });
  if (!row) throw new NotFoundError();
}
