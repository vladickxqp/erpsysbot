/**
 * Shipments of an order: each parcel with its carrier, tracking number and
 * history. A parcel is recorded when the warehouse ships the order or a
 * supplier ships its part; events come from people, suppliers or — for DHL,
 * when the server has a key — the carrier itself. Once a day each open
 * parcel is looked at: no tracking number, late, failed, lost or an
 * exception become a note for those who look after the order. Nothing is
 * guessed: what is not reported stays unknown.
 */
import { and, asc, desc, eq, inArray, isNotNull, lt, notInArray, or, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { orders, shipmentEvents, shipments } from "@/db/schema";
import { withTenant, type Tx } from "@/db/tenant";
import { CARRIERS, carrierOf, dhlStatus, FINAL, problemOf, SHIPMENT_STATUSES, trackingUrl, type Problem } from "@/lib/shipping";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { companyLeads, notify } from "./notifications";
import { requirePermission } from "./permissions";

export class ShipmentError extends Error {
  constructor(public readonly code: "STATUS") {
    super(code);
  }
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

/** A parcel left — from the warehouse or a supplier — inside the caller's transaction. */
export async function recordShipment(
  tx: Tx,
  s: { organizationId: string; orderId: string; supplierOrderId?: string | null; carrier: string | null; trackingNumber: string | null; userId: string | null; source: "manual" | "supplier"; at?: Date },
) {
  const at = s.at ?? new Date();
  const carrier = carrierOf(s.carrier);
  const [row] = await tx
    .insert(shipments)
    .values({
      organizationId: s.organizationId,
      orderId: s.orderId,
      supplierOrderId: s.supplierOrderId ?? null,
      carrier,
      carrierName: carrier === "other" ? (s.carrier?.trim() || null) : null,
      trackingNumber: s.trackingNumber?.trim() || null,
      status: "IN_TRANSIT",
      shippedAt: at,
      lastEventAt: at,
    })
    .returning();
  await tx.insert(shipmentEvents).values({ organizationId: s.organizationId, shipmentId: row.id, status: "IN_TRANSIT", source: s.source, occurredAt: at, userId: s.userId });
  return row;
}

/** The parcels of an order (or of one supplier order) arrived. */
export async function deliverShipments(tx: Tx, where: { organizationId: string; orderId?: string; supplierOrderId?: string }, userId: string | null, source: "manual" | "supplier", at = new Date()): Promise<number> {
  const which = where.supplierOrderId ? eq(shipments.supplierOrderId, where.supplierOrderId) : eq(shipments.orderId, where.orderId ?? "");
  const open = await tx.select({ id: shipments.id }).from(shipments).where(and(which, notInArray(shipments.status, FINAL)));
  for (const s of open) {
    await tx.update(shipments).set({ status: "DELIVERED", deliveredAt: at, lastEventAt: at, problem: null, updatedAt: at }).where(eq(shipments.id, s.id));
    await tx.insert(shipmentEvents).values({ organizationId: where.organizationId, shipmentId: s.id, status: "DELIVERED", source, occurredAt: at, userId });
  }
  return open.length;
}

export type ShipmentView = {
  id: string;
  supplierOrderId: string | null;
  carrier: string;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  problem: string | null;
  costCents: number | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  events: { id: string; status: string; note: string | null; location: string | null; source: string; at: string }[];
};

async function viewsOf(tx: Tx, orderId: string): Promise<ShipmentView[]> {
  const rows = await tx.select().from(shipments).where(eq(shipments.orderId, orderId)).orderBy(asc(shipments.createdAt));
  const events = rows.length
    ? await tx
        .select()
        .from(shipmentEvents)
        .where(inArray(shipmentEvents.shipmentId, rows.map((r) => r.id)))
        .orderBy(desc(shipmentEvents.occurredAt), desc(shipmentEvents.createdAt))
    : [];
  return rows.map((s) => ({
    id: s.id,
    supplierOrderId: s.supplierOrderId,
    carrier: s.carrier,
    carrierName: s.carrierName,
    trackingNumber: s.trackingNumber,
    trackingUrl: trackingUrl(s.carrier, s.trackingNumber),
    status: s.status,
    problem: s.problem,
    costCents: s.costCents,
    shippedAt: s.shippedAt?.toISOString() ?? null,
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
    events: events
      .filter((e) => e.shipmentId === s.id)
      .map((e) => ({ id: e.id, status: e.status, note: e.note, location: e.location, source: e.source, at: e.occurredAt.toISOString() })),
  }));
}

export async function shipmentsOf(ctx: Context, orderId: string): Promise<ShipmentView[]> {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, (tx) => viewsOf(tx, orderId));
}

/** For the buyer's own page: the parcels of their order, with only what was recorded. */
export async function shipmentsForBuyer(organizationId: string, orderId: string): Promise<ShipmentView[]> {
  return withTenant(organizationId, (tx) => viewsOf(tx, orderId));
}

export const shipmentInput = z.object({
  carrier: z.enum(CARRIERS),
  carrierName: text(80),
  trackingNumber: text(60),
  costCents: z.coerce.number().int().min(0).max(10_000_000).nullish().transform((v) => v ?? null),
});
export type ShipmentInput = z.input<typeof shipmentInput>;

async function shipmentOf(tx: Tx, id: string) {
  const [row] = await tx.select().from(shipments).where(eq(shipments.id, id)).for("update");
  if (!row) throw new NotFoundError();
  return row;
}

/** Carrier, number and cost of a parcel, as a person corrects them. */
export async function saveShipment(ctx: Context, id: string, raw: ShipmentInput): Promise<void> {
  requirePermission(ctx.permissions, "orders.update");
  const input = shipmentInput.parse(raw);
  await withTenant(ctx.organization.id, async (tx) => {
    const row = await shipmentOf(tx, id);
    const problem = problemOf({ status: row.status, trackingNumber: input.trackingNumber, shippedAt: row.shippedAt }, new Date());
    await tx
      .update(shipments)
      .set({ carrier: input.carrier, carrierName: input.carrier === "other" ? input.carrierName : null, trackingNumber: input.trackingNumber, costCents: input.costCents, problem, updatedAt: new Date() })
      .where(eq(shipments.id, id));
    await audit(tx, ctx, "shipment.update", "order", row.orderId, { shipment: id, carrier: input.carrier, trackingNumber: input.trackingNumber });
  });
}

/** A parcel added by hand, e.g. a second parcel or a replacement for a lost one. */
export async function addShipment(ctx: Context, orderId: string, raw: ShipmentInput): Promise<void> {
  requirePermission(ctx.permissions, "orders.update");
  const input = shipmentInput.parse(raw);
  await withTenant(ctx.organization.id, async (tx) => {
    const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId));
    if (!order) throw new NotFoundError();
    const row = await recordShipment(tx, {
      organizationId: ctx.organization.id,
      orderId,
      carrier: input.carrier === "other" ? (input.carrierName ?? "other") : input.carrier,
      trackingNumber: input.trackingNumber,
      userId: ctx.user.userId,
      source: "manual",
    });
    if (input.costCents !== null) await tx.update(shipments).set({ costCents: input.costCents }).where(eq(shipments.id, row.id));
    await audit(tx, ctx, "shipment.create", "order", orderId, { shipment: row.id });
  });
}

export const eventInput = z.object({
  status: z.enum(SHIPMENT_STATUSES),
  note: text(500),
  location: text(120),
  at: z.coerce.date().nullish(),
});
export type ShipmentEventInput = z.input<typeof eventInput>;

/** What a person learned about a parcel; a delivery that completes the order completes it. */
export async function addShipmentEvent(ctx: Context, id: string, raw: ShipmentEventInput): Promise<void> {
  requirePermission(ctx.permissions, "orders.update");
  const input = eventInput.parse(raw);
  const now = new Date();
  const at = input.at && input.at <= now ? input.at : now;
  const orderId = await withTenant(ctx.organization.id, async (tx) => {
    const row = await shipmentOf(tx, id);
    await tx.insert(shipmentEvents).values({ organizationId: ctx.organization.id, shipmentId: id, status: input.status, note: input.note, location: input.location, source: "manual", occurredAt: at, userId: ctx.user.userId });
    const problem = problemOf({ status: input.status, trackingNumber: row.trackingNumber, shippedAt: row.shippedAt }, now);
    await tx
      .update(shipments)
      .set({ status: input.status, problem, lastEventAt: at, ...(input.status === "DELIVERED" ? { deliveredAt: at } : {}), updatedAt: now })
      .where(eq(shipments.id, id));
    await audit(tx, ctx, "shipment.event", "order", row.orderId, { shipment: id, status: input.status });
    return row.orderId;
  });
  if (input.status === "DELIVERED") await completeIfDelivered(ctx, orderId);
}

/** All parcels of a shipped order arrived: the order is delivered, as if a person said so. */
async function completeIfDelivered(ctx: Context, orderId: string): Promise<void> {
  const state = await withTenant(ctx.organization.id, async (tx) => {
    const [order] = await tx.select({ fulfillment: orders.fulfillmentStatus }).from(orders).where(eq(orders.id, orderId));
    const open = await tx.select({ id: shipments.id }).from(shipments).where(and(eq(shipments.orderId, orderId), notInArray(shipments.status, ["DELIVERED"])));
    return { fulfillment: order?.fulfillment, open: open.length };
  });
  if (state.fulfillment !== "SHIPPED" || state.open > 0) return;
  const { runOrderAction } = await import("./order-flow");
  await runOrderAction(ctx, orderId, "deliver", {}).catch((e) => console.error("shipments: deliver failed", e instanceof Error ? e.message : e));
}

const PROBLEM_KIND: Record<Problem, string> = {
  MISSING_TRACKING: "shipmentMissingTracking",
  DELAYED: "shipmentDelayed",
  FAILED: "shipmentFailed",
  EXCEPTION: "shipmentException",
  LOST: "shipmentLost",
};

/** Once a day: what is wrong with a company's open parcels, told once per parcel and problem. */
export async function checkShipments(organizationId: string, now = new Date()): Promise<number> {
  const rows = await withTenant(organizationId, (tx) =>
    tx
      .select({ shipment: shipments, number: orders.number, assigned: orders.assignedUserId })
      .from(shipments)
      .innerJoin(orders, eq(orders.id, shipments.orderId))
      .where(and(notInArray(shipments.status, FINAL), isNotNull(shipments.shippedAt)))
      .limit(500),
  );
  let told = 0;
  const leads = await companyLeads(organizationId);
  for (const { shipment, number, assigned } of rows) {
    const problem = problemOf(shipment, now);
    if (problem !== shipment.problem) {
      await withTenant(organizationId, (tx) => tx.update(shipments).set({ problem, updatedAt: now }).where(eq(shipments.id, shipment.id)));
    }
    if (!problem) continue;
    told += await notify(organizationId, [...new Set([...(assigned ? [assigned] : []), ...leads])], {
      category: "failure",
      kind: PROBLEM_KIND[problem],
      vars: { number },
      href: `/app/orders/${shipment.orderId}`,
      entity: "order",
      entityId: shipment.orderId,
      priority: 2,
      dedupeKey: `shipment-problem:${shipment.id}:${problem}`,
    });
  }
  return told;
}

// --- DHL tracking ------------------------------------------------------------------------------------

export type TrackFetch = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type DhlEvent = { timestamp?: string; statusCode?: string; status?: string; description?: string; location?: { address?: { addressLocality?: string } } };
type DhlAnswer = { shipments?: { status?: DhlEvent; events?: DhlEvent[] }[] };

const SYNC_EVERY = 2 * 3_600_000;

/**
 * DHL's tracking interface, for parcels sent with DHL, when the server has a
 * key (DHL_API_KEY, from developer.dhl.com). Each reported event is kept
 * once; the latest status becomes the parcel's.
 */
export async function syncDhl(now = new Date(), fetcher: TrackFetch = fetch as unknown as TrackFetch, key = process.env.DHL_API_KEY): Promise<number> {
  if (!key) return 0;
  const due = await getDb()
    .select()
    .from(shipments)
    .where(
      and(
        eq(shipments.carrier, "dhl"),
        isNotNull(shipments.trackingNumber),
        notInArray(shipments.status, FINAL),
        or(isNull(shipments.syncedAt), lt(shipments.syncedAt, new Date(now.getTime() - SYNC_EVERY))),
      ),
    )
    .limit(50);
  let changed = 0;
  for (const s of due) {
    const answer = await fetcher(`https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(s.trackingNumber!)}`, {
      headers: { "DHL-API-Key": key, Accept: "application/json" },
    }).catch(() => null);
    await withTenant(s.organizationId, (tx) => tx.update(shipments).set({ syncedAt: now }).where(eq(shipments.id, s.id)));
    if (!answer?.ok) continue;
    const body = (await answer.json().catch(() => ({}))) as DhlAnswer;
    const found = body.shipments?.[0];
    if (!found) continue;
    const status = dhlStatus(found.status?.statusCode);
    const delivered = await withTenant(s.organizationId, async (tx) => {
      for (const e of found.events ?? []) {
        const mapped = dhlStatus(e.statusCode) ?? "IN_TRANSIT";
        const at = e.timestamp ? new Date(e.timestamp) : now;
        await tx
          .insert(shipmentEvents)
          .values({
            organizationId: s.organizationId,
            shipmentId: s.id,
            status: mapped,
            note: (e.description ?? e.status ?? "").slice(0, 500) || null,
            location: e.location?.address?.addressLocality?.slice(0, 120) ?? null,
            source: "carrier",
            externalKey: `${e.timestamp ?? ""}|${e.statusCode ?? ""}|${e.description ?? e.status ?? ""}`.slice(0, 300),
            occurredAt: Number.isNaN(at.getTime()) ? now : at,
          })
          .onConflictDoNothing();
      }
      if (!status || status === s.status) return false;
      await tx
        .update(shipments)
        .set({ status, problem: problemOf({ ...s, status }, now), lastEventAt: now, ...(status === "DELIVERED" ? { deliveredAt: now } : {}), updatedAt: now })
        .where(eq(shipments.id, s.id));
      changed++;
      return status === "DELIVERED";
    });
    if (delivered) {
      const { companyContext } = await import("./automations");
      const ctx = await companyContext(s.organizationId);
      if (ctx) await completeIfDelivered(ctx, s.orderId);
    }
  }
  return changed;
}

