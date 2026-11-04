/**
 * Time tracking: a timer or a hand-written entry, on a client, project or
 * task. Everyone sees and changes their own time; billing turns unbilled
 * billable time of one client into an invoice draft, once.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import { allowedRates } from "@/lib/countries";
import { clients, projects, tasks, timeEntries } from "@/db/schema";
import { withTenant, type Tx } from "@/db/tenant";
import { audit } from "./audit";
import { displayName, NotFoundError } from "./clients";
import type { Context } from "./context";
import { createInvoiceDraft, type Invoice } from "./invoices";
import { requirePermission } from "./permissions";

export type TimeEntry = typeof timeEntries.$inferSelect;

export class TimeError extends Error {
  constructor(public readonly code: "RUNNING" | "END_BEFORE_START" | "BILLED" | "NOTHING") {
    super(code);
  }
}

const optionalId = z.string().uuid().nullish().transform((v) => v || null);
const links = {
  description: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null),
  clientId: optionalId,
  projectId: optionalId,
  taskId: optionalId,
  billable: z.boolean().default(true),
};

export const timerInput = z.object(links);
export const entryInput = z.object({ ...links, startedAt: z.coerce.date(), endedAt: z.coerce.date() });
export type TimerInput = z.input<typeof timerInput>;
export type EntryInput = z.input<typeof entryInput>;

async function checkLinks(tx: Tx, input: { clientId: string | null; projectId: string | null; taskId: string | null }) {
  // Links must point into this company (RLS hides others, so "not found" is enough).
  if (input.clientId && !(await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, input.clientId))).length) throw new NotFoundError();
  if (input.projectId && !(await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId))).length) throw new NotFoundError();
  if (input.taskId && !(await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, input.taskId))).length) throw new NotFoundError();
}

const mine = (ctx: Context) => eq(timeEntries.userId, ctx.user.userId);

export async function runningTimer(ctx: Context): Promise<TimeEntry | null> {
  requirePermission(ctx.permissions, "time.read");
  const [row] = await withTenant(ctx.organization.id, (tx) =>
    tx
      .select()
      .from(timeEntries)
      .where(and(mine(ctx), isNull(timeEntries.endedAt)))
      .limit(1),
  );
  return row ?? null;
}

/** One timer per person. */
export async function startTimer(ctx: Context, raw: TimerInput): Promise<TimeEntry> {
  requirePermission(ctx.permissions, "time.manage");
  const input = timerInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    await checkLinks(tx, input);
    const [running] = await tx
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(mine(ctx), isNull(timeEntries.endedAt)));
    if (running) throw new TimeError("RUNNING");
    const [row] = await tx
      .insert(timeEntries)
      .values({ ...input, organizationId: ctx.organization.id, userId: ctx.user.userId, startedAt: new Date() })
      .returning();
    return row;
  });
}

export async function stopTimer(ctx: Context, at = new Date()): Promise<TimeEntry> {
  requirePermission(ctx.permissions, "time.manage");
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .update(timeEntries)
      .set({ endedAt: at })
      .where(and(mine(ctx), isNull(timeEntries.endedAt)))
      .returning();
    if (!row) throw new NotFoundError();
    return row;
  });
}

export async function addEntry(ctx: Context, raw: EntryInput): Promise<TimeEntry> {
  requirePermission(ctx.permissions, "time.manage");
  const input = entryInput.parse(raw);
  if (input.endedAt <= input.startedAt) throw new TimeError("END_BEFORE_START");
  return withTenant(ctx.organization.id, async (tx) => {
    await checkLinks(tx, input);
    const [row] = await tx
      .insert(timeEntries)
      .values({ ...input, organizationId: ctx.organization.id, userId: ctx.user.userId })
      .returning();
    return row;
  });
}

/** One's own, and only while it is not on an invoice. */
export async function deleteEntry(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "time.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .select({ invoiceId: timeEntries.invoiceId })
      .from(timeEntries)
      .where(and(eq(timeEntries.id, id), mine(ctx)));
    if (!row) throw new NotFoundError();
    if (row.invoiceId) throw new TimeError("BILLED");
    await tx.delete(timeEntries).where(eq(timeEntries.id, id));
  });
}

export const minutesOf = (e: Pick<TimeEntry, "startedAt" | "endedAt">, now = new Date()) =>
  Math.max(0, Math.round(((e.endedAt ?? now).getTime() - e.startedAt.getTime()) / 60_000));

/** Entries of a period, newest first: one's own, or everybody's for those who see the team. */
export async function listEntries(ctx: Context, query: { from?: Date; to?: Date; projectId?: string; clientId?: string; everyone?: boolean } = {}) {
  requirePermission(ctx.permissions, "time.read");
  const filters: SQL[] = [];
  if (!query.everyone || !ctx.permissions.has("employees.read")) filters.push(mine(ctx));
  if (query.from) filters.push(gte(timeEntries.startedAt, query.from));
  if (query.to) filters.push(lt(timeEntries.startedAt, query.to));
  if (query.projectId) filters.push(eq(timeEntries.projectId, query.projectId));
  if (query.clientId) filters.push(eq(timeEntries.clientId, query.clientId));
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ entry: timeEntries, project: projects.name, client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName } })
      .from(timeEntries)
      .leftJoin(projects, eq(projects.id, timeEntries.projectId))
      .leftJoin(clients, eq(clients.id, timeEntries.clientId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(timeEntries.startedAt))
      .limit(500);
    return rows.map((r) => ({ ...r.entry, projectName: r.project, clientName: r.client?.companyName || r.client?.lastName ? displayName(r.client) : null, minutes: minutesOf(r.entry) }));
  });
}

/** Per client: finished billable time not on an invoice yet. */
export async function unbilledByClient(ctx: Context) {
  requirePermission(ctx.permissions, "time.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ entry: timeEntries, client: clients })
      .from(timeEntries)
      .innerJoin(clients, eq(clients.id, timeEntries.clientId))
      .where(and(eq(timeEntries.billable, true), isNull(timeEntries.invoiceId), isNotNull(timeEntries.endedAt)))
      .orderBy(asc(timeEntries.startedAt));
    const byClient = new Map<string, { clientId: string; clientName: string; minutes: number; entries: number }>();
    for (const { entry, client } of rows) {
      const row = byClient.get(client.id) ?? { clientId: client.id, clientName: displayName(client), minutes: 0, entries: 0 };
      row.minutes += minutesOf(entry);
      row.entries += 1;
      byClient.set(client.id, row);
    }
    return [...byClient.values()];
  });
}

/** Unbilled time of a client → an invoice draft, one line per project (or description). */
export async function billClient(ctx: Context, clientId: string, hourlyRateCents: number, unit = "h"): Promise<Invoice> {
  requirePermission(ctx.permissions, "time.manage");
  const rate = z.number().int().positive().max(100_000_000).parse(hourlyRateCents);
  const entries = await withTenant(ctx.organization.id, (tx) =>
    tx
      .select({ entry: timeEntries, project: projects.name })
      .from(timeEntries)
      .leftJoin(projects, eq(projects.id, timeEntries.projectId))
      .where(and(eq(timeEntries.clientId, clientId), eq(timeEntries.billable, true), isNull(timeEntries.invoiceId), isNotNull(timeEntries.endedAt))),
  );
  if (!entries.length) throw new TimeError("NOTHING");
  const groups = new Map<string, number>();
  for (const { entry, project } of entries) {
    const label = project ?? entry.description ?? "—";
    groups.set(label, (groups.get(label) ?? 0) + minutesOf(entry));
  }
  const vatRate = ctx.organization.smallBusiness ? 0 : allowedRates(ctx.organization.taxRates, ctx.organization.country)[0];
  const invoice = await createInvoiceDraft(ctx, {
    clientId,
    items: [...groups].map(([description, minutes]) => ({
      description: description.slice(0, 500),
      quantity: Math.round((minutes / 60) * 100) / 100 || 0.01,
      unit,
      unitPriceCents: rate,
      discountPercent: 0,
      vatRate,
    })),
  });
  await withTenant(ctx.organization.id, async (tx) => {
    await tx
      .update(timeEntries)
      .set({ invoiceId: invoice.id })
      .where(inArray(timeEntries.id, entries.map((e) => e.entry.id)));
    await audit(tx, ctx, "invoice.time", "invoice", invoice.id, { entries: entries.length });
  });
  return invoice;
}
