/**
 * Money back to a customer. Only for a paid order and never more than what
 * is left of the payment; refunds still waiting count against it too. Paid
 * online through the store's Stripe account: refunded there (once, by the
 * refund's own key). Paid by transfer: the company sends the money itself and
 * says when it is done — this app never moves money on its own. Each refund
 * is kept with its amount, reason, way, reference and result.
 */
import Stripe from "stripe";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { orderEvents, orders, refunds, returnEvents, returns, stores } from "@/db/schema";
import { withTenant, type Tx } from "@/db/tenant";
import { formatMoney } from "@/i18n";
import { REFUND_PROVIDERS, type ReturnStatus } from "@/lib/returns";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { ForbiddenError, requirePermission } from "./permissions";
import { mailBuyer } from "./returns";
import { storeSecrets } from "./stores";

export class RefundError extends Error {
  constructor(public readonly code: "NOT_PAID" | "AMOUNT" | "PROVIDER" | "FAILED" | "STATE") {
    super(code);
  }
}

/** Asks Stripe to pay back part of a payment; tests put their own answer here. */
export type StripeRefund = (secretKey: string, p: { paymentIntent: string; amountCents: number; idempotencyKey: string; orderId: string }) => Promise<{ id: string; status: string }>;

const stripeRefund: StripeRefund = async (secretKey, p) => {
  const refund = await new Stripe(secretKey).refunds.create({ payment_intent: p.paymentIntent, amount: p.amountCents, metadata: { orderId: p.orderId } }, { idempotencyKey: p.idempotencyKey });
  return { id: refund.id, status: refund.status ?? "pending" };
};

/** Money goes out: the order's right and the money's (or the company's settings). */
function allowRefund(ctx: Context) {
  requirePermission(ctx.permissions, "orders.update");
  if (!ctx.permissions.has("finance.create") && !ctx.permissions.has("settings.manage")) throw new ForbiddenError("finance.create");
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const refundInput = z.object({
  amountCents: z.coerce.number().int().positive().max(100_000_000),
  provider: z.enum(REFUND_PROVIDERS),
  reason: text(500),
  /** For money already sent (manual): how. */
  reference: text(200),
  returnId: z.string().uuid().nullish().transform((v) => v ?? null),
});
export type RefundInput = z.input<typeof refundInput>;

const PAID = ["PAID", "PARTIALLY_REFUNDED"];

/** Refunds that count against the payment: waiting and done. */
async function committed(tx: Tx, orderId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`coalesce(sum(${refunds.amountCents}), 0)::int` })
    .from(refunds)
    .where(and(eq(refunds.orderId, orderId), inArray(refunds.status, ["PENDING", "SUCCEEDED"])));
  return Number(row?.n ?? 0);
}

/** After a refund went through: the order's payment state, the return's, a line in the order's history. */
async function settle(tx: Tx, ctx: Context, refundId: string): Promise<{ returnId: string | null; amountCents: number }> {
  const [refund] = await tx.select().from(refunds).where(eq(refunds.id, refundId));
  const [order] = await tx.select().from(orders).where(eq(orders.id, refund.orderId)).for("update");
  const [{ done }] = await tx
    .select({ done: sql<number>`coalesce(sum(${refunds.amountCents}), 0)::int` })
    .from(refunds)
    .where(and(eq(refunds.orderId, order.id), eq(refunds.status, "SUCCEEDED")));
  const paymentStatus = Number(done) >= order.grossCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
  await tx.update(orders).set({ paymentStatus, updatedAt: new Date() }).where(eq(orders.id, order.id));
  await tx.insert(orderEvents).values({ organizationId: ctx.organization.id, orderId: order.id, kind: "refunded", data: { amount: refund.amountCents, provider: refund.provider }, userId: ctx.user.userId });
  if (refund.returnId) {
    const [ret] = await tx.select().from(returns).where(eq(returns.id, refund.returnId)).for("update");
    const [{ forReturn }] = await tx
      .select({ forReturn: sql<number>`coalesce(sum(${refunds.amountCents}), 0)::int` })
      .from(refunds)
      .where(and(eq(refunds.returnId, refund.returnId), eq(refunds.status, "SUCCEEDED")));
    // The return is refunded once the money for it went out, when its goods are back.
    if (ret && (["RECEIVED", "INSPECTION", "REFUND_PENDING"] as ReturnStatus[]).includes(ret.status as ReturnStatus) && Number(forReturn) >= ret.refundCents) {
      await tx.update(returns).set({ status: "REFUNDED", updatedAt: new Date() }).where(eq(returns.id, ret.id));
      await tx.insert(returnEvents).values({ organizationId: ctx.organization.id, returnId: ret.id, kind: "REFUNDED", data: { from: ret.status, amount: Number(forReturn) }, userId: ctx.user.userId });
    }
  }
  return { returnId: refund.returnId, amountCents: refund.amountCents };
}

async function told(ctx: Context, result: { returnId: string | null; amountCents: number }) {
  if (!result.returnId) return;
  const amount = formatMoney(result.amountCents, "de", { country: ctx.organization.country, currency: ctx.organization.currency });
  await mailBuyer(ctx.organization.id, result.returnId, "refunded", amount).catch((e) => console.error("refunds: mail failed", e instanceof Error ? e.message : e));
}

/**
 * Pays money back for an order (or for one of its returns). Stripe: at once
 * through the store's account. Bank: waits until the company says it sent it.
 * Manual: recorded as already done.
 */
export async function refundOrder(ctx: Context, orderId: string, raw: RefundInput, refund: StripeRefund = stripeRefund): Promise<{ id: string; status: string }> {
  allowRefund(ctx);
  const input = refundInput.parse(raw);
  const planned = await withTenant(ctx.organization.id, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw new NotFoundError();
    if (!PAID.includes(order.paymentStatus)) throw new RefundError("NOT_PAID");
    if (input.amountCents > order.grossCents - (await committed(tx, orderId))) throw new RefundError("AMOUNT");
    if (input.returnId) {
      const [ret] = await tx.select({ orderId: returns.orderId }).from(returns).where(eq(returns.id, input.returnId));
      if (!ret || ret.orderId !== orderId) throw new NotFoundError();
    }
    let secret: string | null = null;
    if (input.provider === "stripe") {
      const [store] = order.storeId ? await tx.select().from(stores).where(eq(stores.id, order.storeId)) : [];
      secret = store ? storeSecrets(store).secretKey : null;
      if (order.paymentMethod !== "stripe" || !order.paymentReference?.startsWith("pi_") || !secret) throw new RefundError("PROVIDER");
    }
    const [row] = await tx
      .insert(refunds)
      .values({
        organizationId: ctx.organization.id,
        orderId,
        returnId: input.returnId,
        amountCents: input.amountCents,
        reason: input.reason,
        provider: input.provider,
        status: input.provider === "manual" ? "SUCCEEDED" : "PENDING",
        reference: input.provider === "manual" ? input.reference : null,
        createdBy: ctx.user.userId,
        completedAt: input.provider === "manual" ? new Date() : null,
      })
      .returning();
    await audit(tx, ctx, "refund.create", "refund", row.id, { order: order.number, amount: input.amountCents, provider: input.provider });
    const result = input.provider === "manual" ? await settle(tx, ctx, row.id) : null;
    return { id: row.id, paymentIntent: order.paymentReference, secret, result };
  });

  if (input.provider === "manual") {
    if (planned.result) await told(ctx, planned.result);
    return { id: planned.id, status: "SUCCEEDED" };
  }
  if (input.provider === "bank") return { id: planned.id, status: "PENDING" };

  // Stripe, outside the transaction: the refund row exists, its id makes the request count once.
  try {
    const answer = await refund(planned.secret!, { paymentIntent: planned.paymentIntent!, amountCents: input.amountCents, idempotencyKey: `refund-${planned.id}`, orderId });
    const ok = answer.status === "succeeded" || answer.status === "pending";
    const result = await withTenant(ctx.organization.id, async (tx) => {
      await tx
        .update(refunds)
        .set({ status: ok ? "SUCCEEDED" : "FAILED", reference: answer.id, completedAt: new Date(), ...(ok ? {} : { error: answer.status }) })
        .where(eq(refunds.id, planned.id));
      return ok ? settle(tx, ctx, planned.id) : null;
    });
    if (!ok) throw new RefundError("FAILED");
    if (result) await told(ctx, result);
    return { id: planned.id, status: "SUCCEEDED" };
  } catch (e) {
    if (e instanceof RefundError) throw e;
    const message = e instanceof Error ? e.message.slice(0, 500) : "error";
    await withTenant(ctx.organization.id, (tx) => tx.update(refunds).set({ status: "FAILED", error: message, completedAt: new Date() }).where(eq(refunds.id, planned.id)));
    throw new RefundError("FAILED");
  }
}

/** A bank refund was sent by the company: done, with the transfer's reference. */
export async function markRefundSent(ctx: Context, id: string, raw: { reference?: string | null }): Promise<void> {
  allowRefund(ctx);
  const reference = text(200).parse(raw.reference);
  const result = await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.select().from(refunds).where(eq(refunds.id, id)).for("update");
    if (!row) throw new NotFoundError();
    if (row.status !== "PENDING" || row.provider !== "bank") throw new RefundError("STATE");
    await tx.update(refunds).set({ status: "SUCCEEDED", reference, completedAt: new Date() }).where(eq(refunds.id, id));
    await audit(tx, ctx, "refund.sent", "refund", id, { amount: row.amountCents });
    return settle(tx, ctx, id);
  });
  await told(ctx, result);
}

/** A bank refund that will not be sent after all: it no longer counts against the payment. */
export async function cancelRefund(ctx: Context, id: string): Promise<void> {
  allowRefund(ctx);
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.select().from(refunds).where(eq(refunds.id, id)).for("update");
    if (!row) throw new NotFoundError();
    if (row.status !== "PENDING" || row.provider !== "bank") throw new RefundError("STATE");
    await tx.update(refunds).set({ status: "FAILED", error: "cancelled", completedAt: new Date() }).where(eq(refunds.id, id));
    await audit(tx, ctx, "refund.cancel", "refund", id, { amount: row.amountCents });
  });
}

export type RefundView = { id: string; returnId: string | null; amountCents: number; provider: string; status: string; reason: string | null; reference: string | null; error: string | null; createdAt: string };

export async function refundsOf(ctx: Context, orderId: string): Promise<{ list: RefundView[]; leftCents: number; canStripe: boolean }> {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new NotFoundError();
    const rows = await tx.select().from(refunds).where(eq(refunds.orderId, orderId)).orderBy(desc(refunds.createdAt));
    const [store] = order.storeId ? await tx.select().from(stores).where(eq(stores.id, order.storeId)) : [];
    return {
      list: rows.map((r) => ({ id: r.id, returnId: r.returnId, amountCents: r.amountCents, provider: r.provider, status: r.status, reason: r.reason, reference: r.reference, error: r.error, createdAt: r.createdAt.toISOString() })),
      leftCents: PAID.includes(order.paymentStatus) ? Math.max(0, order.grossCents - (await committed(tx, orderId))) : 0,
      canStripe: order.paymentMethod === "stripe" && !!order.paymentReference?.startsWith("pi_") && !!store && !!storeSecrets(store).secretKey,
    };
  });
}
