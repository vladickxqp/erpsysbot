/**
 * Goals and habits: one person's own, in any workspace with the module on.
 * Every query names the person — not even the owner of the workspace sees
 * someone else's.
 */
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { goals, habitChecks, habits, personalTransactions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { addDays, today } from "./money";
import { assertModule } from "./modules";

const title = z.string().trim().min(1).max(200);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const moneyInput = z.object({
  kind: z.enum(["IN", "OUT"]),
  amountCents: z.coerce.number().int().min(1).max(1_000_000_000),
  bookedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().trim().max(60).nullish(),
  description: z.string().trim().max(200).nullish(),
});

/** One's own income or spending: it never touches the company's figures. */
export async function addPersonalMoney(ctx: Context, raw: z.input<typeof moneyInput>): Promise<void> {
  assertModule(ctx, "personal");
  const input = moneyInput.parse(raw);
  await withTenant(ctx.organization.id, (tx) => tx.insert(personalTransactions).values({ ...input, organizationId: ctx.organization.id, userId: ctx.user.userId }));
}

export async function deletePersonalMoney(ctx: Context, id: string): Promise<void> {
  await withTenant(ctx.organization.id, (tx) => tx.delete(personalTransactions).where(and(eq(personalTransactions.id, id), eq(personalTransactions.userId, ctx.user.userId))));
}

/** The month so far, only for the person themselves. */
export async function personalMoney(ctx: Context, month: string) {
  assertModule(ctx, "personal");
  const first = new Date(`${month}-01T12:00:00Z`);
  first.setUTCMonth(first.getUTCMonth() + 1);
  const next = first.toISOString().slice(0, 10);
  const rows = await withTenant(ctx.organization.id, (tx) =>
    tx
      .select()
      .from(personalTransactions)
      .where(and(eq(personalTransactions.userId, ctx.user.userId), gte(personalTransactions.bookedOn, `${month}-01`), lt(personalTransactions.bookedOn, next)))
      .orderBy(desc(personalTransactions.bookedOn))
      .limit(200),
  );
  const sum = (kind: string) => rows.filter((r) => r.kind === kind).reduce((total, r) => total + r.amountCents, 0);
  return { rows, inCents: sum("IN"), outCents: sum("OUT") };
}

export const goalInput = z.object({
  title,
  targetDate: isoDate.nullish().transform((v) => v || null),
  progress: z.coerce.number().int().min(0).max(100).default(0),
});

export async function saveGoal(ctx: Context, id: string | null, raw: z.input<typeof goalInput>) {
  assertModule(ctx, "personal");
  const input = goalInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    if (id) {
      const [row] = await tx
        .update(goals)
        .set(input)
        .where(and(eq(goals.id, id), eq(goals.userId, ctx.user.userId)))
        .returning();
      if (!row) throw new NotFoundError();
      return row;
    }
    const [row] = await tx
      .insert(goals)
      .values({ ...input, organizationId: ctx.organization.id, userId: ctx.user.userId })
      .returning();
    return row;
  });
}

export async function deleteGoal(ctx: Context, id: string): Promise<void> {
  assertModule(ctx, "personal");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .delete(goals)
      .where(and(eq(goals.id, id), eq(goals.userId, ctx.user.userId)))
      .returning({ id: goals.id });
    if (!row) throw new NotFoundError();
  });
}

export async function addHabit(ctx: Context, raw: string) {
  assertModule(ctx, "personal");
  const name = title.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.insert(habits).values({ organizationId: ctx.organization.id, userId: ctx.user.userId, title: name }).returning();
    return row;
  });
}

export async function deleteHabit(ctx: Context, id: string): Promise<void> {
  assertModule(ctx, "personal");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .delete(habits)
      .where(and(eq(habits.id, id), eq(habits.userId, ctx.user.userId)))
      .returning({ id: habits.id });
    if (!row) throw new NotFoundError();
  });
}

/** Ticks or unticks a day; returns whether it is ticked now. */
export async function toggleHabit(ctx: Context, id: string, rawDay: string): Promise<boolean> {
  assertModule(ctx, "personal");
  const day = isoDate.parse(rawDay);
  return withTenant(ctx.organization.id, async (tx) => {
    const [habit] = await tx
      .select({ id: habits.id })
      .from(habits)
      .where(and(eq(habits.id, id), eq(habits.userId, ctx.user.userId)));
    if (!habit) throw new NotFoundError();
    const removed = await tx
      .delete(habitChecks)
      .where(and(eq(habitChecks.habitId, id), eq(habitChecks.day, day)))
      .returning({ id: habitChecks.id });
    if (removed.length) return false;
    await tx.insert(habitChecks).values({ organizationId: ctx.organization.id, habitId: id, day });
    return true;
  });
}

/** Days in a row up to today (or yesterday, while today is still open). */
export function streak(days: Set<string>, now: string): number {
  let at = days.has(now) ? now : addDays(now, -1);
  let n = 0;
  while (days.has(at)) {
    n++;
    at = addDays(at, -1);
  }
  return n;
}

export async function personalOverview(ctx: Context) {
  assertModule(ctx, "personal");
  const now = today(ctx.organization.timezone);
  return withTenant(ctx.organization.id, async (tx) => {
    const mineGoals = await tx.select().from(goals).where(eq(goals.userId, ctx.user.userId)).orderBy(asc(goals.createdAt));
    const mineHabits = await tx.select().from(habits).where(eq(habits.userId, ctx.user.userId)).orderBy(asc(habits.createdAt));
    const checks = mineHabits.length
      ? await tx
          .select()
          .from(habitChecks)
          .where(and(inArray(habitChecks.habitId, mineHabits.map((h) => h.id)), gte(habitChecks.day, addDays(now, -366))))
      : [];
    return {
      today: now,
      goals: mineGoals,
      habits: mineHabits.map((h) => {
        const days = new Set(checks.filter((c) => c.habitId === h.id).map((c) => c.day));
        return { id: h.id, title: h.title, streak: streak(days, now), week: Array.from({ length: 7 }, (_, i) => addDays(now, i - 6)).map((day) => ({ day, done: days.has(day) })) };
      }),
    };
  });
}
