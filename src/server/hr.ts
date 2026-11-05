/**
 * People's time and files: absences with approval, the vacation balance and
 * the staff file. Everyone sees and asks for their own; what is in someone
 * else's file needs hr.read, a decision hr.manage. Nobody decides their own
 * request, except an owner, who has nobody above them.
 */
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { absences, employeeProfiles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { assertModule } from "./modules";
import { companyLeads, notify } from "./notifications";
import { requirePermission } from "./permissions";
import { memberOptions } from "./team";

export const ABSENCE_KINDS = ["VACATION", "SICK", "OTHER"] as const;
export type Absence = typeof absences.$inferSelect;

export class HrError extends Error {
  constructor(public readonly code: "OVERLAP" | "END_BEFORE_START" | "OWN_REQUEST") {
    super(code);
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const absenceInput = z.object({ kind: z.enum(ABSENCE_KINDS), startDate: day, endDate: day, note: z.string().trim().max(500).nullish() });

/** Monday to Friday in a range; public holidays differ by region and are not counted out. */
export function workingDays(from: string, to: string): number {
  let count = 0;
  const end = new Date(`${to}T12:00:00Z`);
  for (const d = new Date(`${from}T12:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const weekday = d.getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

/** Vacation goes to whoever decides; being ill is reported, not asked for. */
export async function requestAbsence(ctx: Context, raw: z.input<typeof absenceInput>): Promise<Absence> {
  assertModule(ctx, "hr");
  const input = absenceInput.parse(raw);
  if (input.endDate < input.startDate) throw new HrError("END_BEFORE_START");
  const row = await withTenant(ctx.organization.id, async (tx) => {
    const clash = await tx
      .select({ id: absences.id })
      .from(absences)
      .where(and(eq(absences.userId, ctx.user.userId), ne(absences.status, "REJECTED"), lte(absences.startDate, input.endDate), gte(absences.endDate, input.startDate)))
      .limit(1);
    if (clash.length) throw new HrError("OVERLAP");
    const [created] = await tx
      .insert(absences)
      .values({ organizationId: ctx.organization.id, userId: ctx.user.userId, kind: input.kind, startDate: input.startDate, endDate: input.endDate, note: input.note ?? null, status: input.kind === "SICK" ? "APPROVED" : "PENDING" })
      .returning();
    await audit(tx, ctx, "team.absence", "absence", created.id, { kind: created.kind, status: created.status });
    return created;
  });
  const leads = (await companyLeads(ctx.organization.id)).filter((id) => id !== ctx.user.userId);
  await notify(ctx.organization.id, leads, {
    category: row.status === "PENDING" ? "approval" : "update",
    kind: row.status === "PENDING" ? "absenceRequest" : "absenceSick",
    vars: { who: ctx.user.name, from: row.startDate, to: row.endDate },
    href: "/app/hr",
    entity: "absence",
    entityId: row.id,
    dedupeKey: `absence:${row.id}`,
  });
  return row;
}

export async function decideAbsence(ctx: Context, id: string, approve: boolean): Promise<void> {
  assertModule(ctx, "hr");
  requirePermission(ctx.permissions, "hr.manage");
  const row = await withTenant(ctx.organization.id, async (tx) => {
    const [current] = await tx.select().from(absences).where(and(eq(absences.id, id), eq(absences.status, "PENDING")));
    if (!current) throw new NotFoundError();
    if (current.userId === ctx.user.userId && ctx.role !== "OWNER") throw new HrError("OWN_REQUEST");
    const [updated] = await tx.update(absences).set({ status: approve ? "APPROVED" : "REJECTED", decidedBy: ctx.user.userId, decidedAt: new Date() }).where(eq(absences.id, id)).returning();
    await audit(tx, ctx, "team.absence", "absence", id, { status: updated.status });
    return updated;
  });
  await notify(ctx.organization.id, [row.userId], {
    category: "update",
    kind: approve ? "absenceApproved" : "absenceRejected",
    vars: { from: row.startDate, to: row.endDate },
    href: "/app/hr",
    entity: "absence",
    entityId: id,
    dedupeKey: `absence-decided:${id}`,
  });
}

/** Takes back one's own request, as long as it has not begun. */
export async function cancelAbsence(ctx: Context, id: string, today: string): Promise<void> {
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(absences).where(and(eq(absences.id, id), eq(absences.userId, ctx.user.userId), gte(absences.startDate, today))).returning({ id: absences.id });
    if (!row) throw new NotFoundError();
  });
}

export async function myAbsences(ctx: Context): Promise<Absence[]> {
  assertModule(ctx, "hr");
  return withTenant(ctx.organization.id, (tx) => tx.select().from(absences).where(eq(absences.userId, ctx.user.userId)).orderBy(desc(absences.startDate)).limit(100));
}

export async function pendingAbsences(ctx: Context): Promise<(Absence & { name: string })[]> {
  assertModule(ctx, "hr");
  requirePermission(ctx.permissions, "hr.manage");
  const rows = await withTenant(ctx.organization.id, (tx) => tx.select().from(absences).where(eq(absences.status, "PENDING")).orderBy(asc(absences.startDate)).limit(100));
  const names = new Map((await memberOptions(ctx)).map((m) => [m.id, m.name]));
  return rows.map((r) => ({ ...r, name: names.get(r.userId) ?? "—" }));
}

/** Who is away when: for colleagues without the reason, which stays in the file. */
export async function awayBetween(ctx: Context, from: string, to: string) {
  if (ctx.disabledModules.has("hr")) return [];
  const rows = await withTenant(ctx.organization.id, (tx) =>
    tx
      .select()
      .from(absences)
      .where(and(eq(absences.status, "APPROVED"), lte(absences.startDate, to), gte(absences.endDate, from)))
      .orderBy(asc(absences.startDate))
      .limit(200),
  );
  const names = new Map((await memberOptions(ctx)).map((m) => [m.id, m.name]));
  const canSeeWhy = ctx.permissions.has("hr.read");
  return rows.map((r) => ({ id: r.id, userId: r.userId, name: names.get(r.userId) ?? "—", startDate: r.startDate, endDate: r.endDate, kind: canSeeWhy || r.userId === ctx.user.userId ? r.kind : null }));
}

/** Days of vacation in a year: what the file grants, what is taken or asked for. */
export async function vacationBalance(ctx: Context, userId: string, year: string) {
  assertModule(ctx, "hr");
  if (userId !== ctx.user.userId) requirePermission(ctx.permissions, "hr.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [profile] = await tx.select({ days: employeeProfiles.vacationDays }).from(employeeProfiles).where(eq(employeeProfiles.userId, userId));
    const rows = await tx
      .select()
      .from(absences)
      .where(and(eq(absences.userId, userId), eq(absences.kind, "VACATION"), inArray(absences.status, ["APPROVED", "PENDING"]), gte(absences.endDate, `${year}-01-01`), lte(absences.startDate, `${year}-12-31`)));
    const inYear = (r: Absence) => workingDays(r.startDate < `${year}-01-01` ? `${year}-01-01` : r.startDate, r.endDate > `${year}-12-31` ? `${year}-12-31` : r.endDate);
    const taken = rows.filter((r) => r.status === "APPROVED").reduce((sum, r) => sum + inYear(r), 0);
    const pending = rows.filter((r) => r.status === "PENDING").reduce((sum, r) => sum + inYear(r), 0);
    const total = profile?.days ?? 30;
    return { total, taken, pending, left: total - taken };
  });
}

const profileInput = z.object({
  position: z.string().trim().max(120).nullish(),
  hireDate: day.nullish(),
  vacationDays: z.coerce.number().int().min(0).max(366),
  phone: z.string().trim().max(60).nullish(),
  emergencyContact: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(4000).nullish(),
});

export async function staffList(ctx: Context) {
  assertModule(ctx, "hr");
  requirePermission(ctx.permissions, "hr.read");
  const [members, profiles] = await Promise.all([memberOptions(ctx), withTenant(ctx.organization.id, (tx) => tx.select().from(employeeProfiles))]);
  return members.map((m) => ({ ...m, profile: profiles.find((p) => p.userId === m.id) ?? null }));
}

export async function saveProfile(ctx: Context, userId: string, raw: z.input<typeof profileInput>): Promise<void> {
  assertModule(ctx, "hr");
  requirePermission(ctx.permissions, "hr.manage");
  if (!(await memberOptions(ctx)).some((m) => m.id === userId)) throw new NotFoundError();
  const input = profileInput.parse(raw);
  const values = { position: input.position ?? null, hireDate: input.hireDate ?? null, vacationDays: input.vacationDays, phone: input.phone ?? null, emergencyContact: input.emergencyContact ?? null, notes: input.notes ?? null };
  await withTenant(ctx.organization.id, async (tx) => {
    await tx.insert(employeeProfiles).values({ ...values, organizationId: ctx.organization.id, userId }).onConflictDoUpdate({ target: [employeeProfiles.organizationId, employeeProfiles.userId], set: values });
    await audit(tx, ctx, "team.profile", "user", userId);
  });
}
