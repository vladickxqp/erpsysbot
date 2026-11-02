/**
 * The sales pipeline: opportunities with a client or lead, from first contact
 * to won or lost. Winning a deal with a lead makes the lead an active client.
 */
import { and, asc, eq, gte, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { clients, deals } from "@/db/schema";
import { audit, type Via } from "./audit";
import { displayName, NotFoundError } from "./clients";
import type { Context } from "./context";
import { today } from "./money";
import { requirePermission } from "./permissions";

export const DEAL_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;
export const OPEN_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export type Deal = typeof deals.$inferSelect;

export const dealInput = z.object({
  title: z.string().trim().min(1).max(200),
  clientId: z.string().uuid(),
  stage: z.enum(DEAL_STAGES).default("NEW"),
  valueCents: z.coerce.number().int().min(0).max(100_000_000_00).default(0),
  source: z
    .string()
    .trim()
    .max(80)
    .nullish()
    .transform((v) => v || null),
  assignedUserId: z.string().uuid().nullish().transform((v) => v || null),
  nextFollowUp: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .transform((v) => v || null),
  notes: z
    .string()
    .trim()
    .max(5000)
    .nullish()
    .transform((v) => v || null),
});
export type DealInput = z.input<typeof dealInput>;

const closed = (stage: DealStage) => stage === "WON" || stage === "LOST";

export async function saveDeal(ctx: Context, id: string | null, raw: DealInput, via: Via = "web"): Promise<Deal> {
  requirePermission(ctx.permissions, id ? "clients.update" : "clients.create");
  const input = dealInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    const [client] = await tx.select({ id: clients.id, status: clients.status }).from(clients).where(eq(clients.id, input.clientId)).limit(1);
    if (!client) throw new NotFoundError();
    let row: Deal;
    if (id) {
      const [current] = await tx.select().from(deals).where(eq(deals.id, id)).limit(1);
      if (!current) throw new NotFoundError();
      [row] = await tx
        .update(deals)
        .set({
          ...input,
          closedAt: closed(input.stage) ? (current.closedAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(deals.id, id))
        .returning();
    } else {
      [row] = await tx
        .insert(deals)
        .values({
          ...input,
          organizationId: ctx.organization.id,
          assignedUserId: input.assignedUserId ?? ctx.user.userId,
          closedAt: closed(input.stage) ? new Date() : null,
        })
        .returning();
    }
    if (input.stage === "WON" && client.status === "LEAD") await tx.update(clients).set({ status: "ACTIVE" }).where(eq(clients.id, client.id));
    await tx.update(clients).set({ lastInteractionAt: new Date() }).where(eq(clients.id, client.id));
    await audit(tx, ctx, id ? "deal.update" : "deal.create", "deal", row.id, { stage: row.stage, value: row.valueCents }, via);
    return row;
  });
}

/** Dragged to another column. */
export async function moveDeal(ctx: Context, id: string, stage: DealStage): Promise<void> {
  requirePermission(ctx.permissions, "clients.update");
  await withTenant(ctx.organization.id, async (tx) => {
    const [current] = await tx.select().from(deals).where(eq(deals.id, id)).limit(1);
    if (!current) throw new NotFoundError();
    if (current.stage === stage) return;
    await tx
      .update(deals)
      .set({ stage, closedAt: closed(stage) ? new Date() : null, updatedAt: new Date() })
      .where(eq(deals.id, id));
    if (stage === "WON") await tx.update(clients).set({ status: "ACTIVE" }).where(and(eq(clients.id, current.clientId), eq(clients.status, "LEAD")));
    await audit(tx, ctx, "deal.move", "deal", id, { from: current.stage, to: stage });
  });
}

export async function deleteDeal(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "clients.delete");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(deals).where(eq(deals.id, id)).returning({ title: deals.title });
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "deal.delete", "deal", id, { title: row.title });
  });
}

/** Open deals, plus those closed in the last 30 days. */
export async function listDeals(ctx: Context, opts: { clientId?: string } = {}) {
  requirePermission(ctx.permissions, "clients.read");
  const since = new Date(Date.now() - 30 * 86_400_000);
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ deal: deals, client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName } })
      .from(deals)
      .innerJoin(clients, eq(clients.id, deals.clientId))
      .where(
        and(
          opts.clientId ? eq(deals.clientId, opts.clientId) : undefined,
          sql`(${deals.closedAt} is null or ${deals.closedAt} >= ${since})`,
        ),
      )
      .orderBy(asc(deals.position), asc(deals.createdAt));
    return rows.map((r) => ({ ...r.deal, clientName: displayName(r.client) }));
  });
}

/** Pipeline value per stage and the win rate of the last 90 days. */
export async function pipelineStats(ctx: Context) {
  requirePermission(ctx.permissions, "clients.read");
  const since = new Date(Date.now() - 90 * 86_400_000);
  return withTenant(ctx.organization.id, async (tx) => {
    const open = await tx
      .select({ stage: deals.stage, count: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${deals.valueCents}), 0)::bigint` })
      .from(deals)
      .where(inArray(deals.stage, [...OPEN_STAGES]))
      .groupBy(deals.stage);
    const [rate] = await tx
      .select({
        won: sql<number>`count(*) filter (where ${deals.stage} = 'WON')::int`,
        lost: sql<number>`count(*) filter (where ${deals.stage} = 'LOST')::int`,
      })
      .from(deals)
      .where(and(isNotNull(deals.closedAt), gte(deals.closedAt, since)));
    const won = Number(rate.won);
    const lost = Number(rate.lost);
    return {
      open: open.map((o) => ({ stage: o.stage, count: Number(o.count), valueCents: Number(o.value) })),
      winRate: won + lost ? won / (won + lost) : null,
    };
  });
}

/** Follow-ups due today or earlier, for the morning summary. */
export async function dueFollowUps(ctx: Context, userId?: string) {
  requirePermission(ctx.permissions, "clients.read");
  const now = today(ctx.organization.timezone);
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ deal: deals, client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName } })
      .from(deals)
      .innerJoin(clients, eq(clients.id, deals.clientId))
      .where(
        and(
          notInArray(deals.stage, ["WON", "LOST"]),
          isNotNull(deals.nextFollowUp),
          lt(deals.nextFollowUp, addOne(now)),
          userId ? eq(deals.assignedUserId, userId) : undefined,
        ),
      )
      .orderBy(asc(deals.nextFollowUp));
    return rows.map((r) => ({ ...r.deal, clientName: displayName(r.client) }));
  });
}

function addOne(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
