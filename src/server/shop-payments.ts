/**
 * Card payment in a store, through the company's own Stripe account.
 *
 * The buyer pays on Stripe's hosted page; no card data ever reaches the app.
 * An order counts as paid only when Stripe says so in a message signed with
 * the store's webhook secret, and only when the amount and currency are the
 * order's own. Each message is handled once (Stripe repeats them), in the same
 * transaction as its effect, so a failure leaves nothing half done and Stripe
 * simply sends it again.
 */
import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
import { getDb } from "@/db/client";
import { orderEvents, orderItems, orders, organizations, shopPaymentEvents, stores } from "@/db/schema";
import { withTenant, type Tx } from "@/db/tenant";
import { formatMoney, MESSAGES, translator } from "@/i18n";
import { audit } from "./audit";
import { companyContext } from "./automations";
import type { Context } from "./context";
import { companyLeads, notify } from "./notifications";
import { appUrl } from "./settings";
import { storeSecrets } from "./stores";
import { afterPayment, cancelSupplierOrdersOf } from "./dropship";
import { findStore, mailBuyer, placeOrder, StorefrontError, type CheckoutInput, type PublicStore } from "./storefront";

export class ShopPaymentError extends Error {
  constructor(public readonly code: "UNKNOWN" | "SIGNATURE") {
    super(code);
  }
}

/** Starts a hosted payment; tests put their own here. */
export type CreateSession = (secretKey: string, params: Stripe.Checkout.SessionCreateParams, idempotencyKey: string) => Promise<{ id: string; url: string | null }>;

const createSession: CreateSession = async (secretKey, params, idempotencyKey) => {
  const session = await new Stripe(secretKey).checkout.sessions.create(params, { idempotencyKey });
  return { id: session.id, url: session.url };
};

/** How long a started payment stays open (Stripe allows 30 minutes at least); then the goods are free again. */
const OPEN_MINUTES = 35;
const STRIPE_LOCALES: Record<string, Stripe.Checkout.SessionCreateParams.Locale> = { de: "de", en: "en", es: "es" };

async function event(tx: Tx, organizationId: string, orderId: string, kind: string, data: Record<string, unknown> = {}) {
  await tx.insert(orderEvents).values({ organizationId, orderId, kind, data, userId: null });
}

/** The goods go back on the shelf: an unpaid order whose payment did not start or ran out. */
async function cancelUnpaid(tx: Tx, organizationId: string, orderId: string, kind: string): Promise<boolean> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order || order.paymentStatus !== "UNPAID" || !["UNFULFILLED", "RESERVED", "AT_SUPPLIER"].includes(order.fulfillmentStatus)) return false;
  // What is already with a supplier keeps the order: a person decides.
  if (!(await cancelSupplierOrdersOf(tx, { organizationId, userId: null, ctx: null, via: "shop" }, orderId))) return false;
  const now = new Date();
  await tx.update(orders).set({ fulfillmentStatus: "CANCELLED", status: "CANCELLED", cancelledAt: now, updatedAt: now }).where(eq(orders.id, orderId));
  await event(tx, organizationId, orderId, kind);
  return true;
}

/**
 * The buyer's order, and for card payment the way to Stripe's page.
 * When the payment cannot be started the order is cancelled again at once.
 */
export async function checkout(store: PublicStore, raw: CheckoutInput, visitor: string, create: CreateSession = createSession): Promise<{ token: string; payUrl: string | null }> {
  const placed = await placeOrder(store, raw, visitor);
  if (placed.payment !== "stripe") return { token: placed.token, payUrl: null };
  try {
    const payUrl = await startCardPayment(store, placed, String(raw.email ?? ""), create);
    return { token: placed.token, payUrl };
  } catch (e) {
    console.error("shop: card payment could not start", e instanceof Error ? e.message : e);
    await withTenant(store.organizationId, (tx) => cancelUnpaid(tx, store.organizationId, placed.orderId, "paymentFailed"));
    throw new StorefrontError("PAYMENT");
  }
}

async function startCardPayment(store: PublicStore, placed: { orderId: string; number: number; token: string; grossCents: number }, email: string, create: CreateSession): Promise<string> {
  const [row] = await getDb().select().from(stores).where(eq(stores.id, store.id)).limit(1);
  const { secretKey } = row ? storeSecrets(row) : { secretKey: null };
  const base = appUrl();
  if (!secretKey || !base) throw new Error("card payment not set up");
  const t = translator(MESSAGES[store.locale]);
  const items = await withTenant(store.organizationId, (tx) => tx.select().from(orderItems).where(and(eq(orderItems.orderId, placed.orderId))).orderBy(orderItems.position));
  const reference = `${store.slug}-${placed.number}`;
  const summary = items
    .filter((i) => i.productId)
    .map((i) => `${Number(i.quantity)} × ${i.description}`)
    .join(", ")
    .slice(0, 480);
  const back = `${base}/shop/${store.slug}/order/${placed.token}`;
  // One line with the order's total: what is charged is exactly what the order says.
  const session = await create(
    secretKey,
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: store.currency.toLowerCase(),
            unit_amount: placed.grossCents,
            product_data: { name: `${store.name} · ${t("store.shop.order")} ${reference}`.slice(0, 250), ...(summary ? { description: summary } : {}) },
          },
        },
      ],
      customer_email: email || undefined,
      client_reference_id: placed.orderId,
      metadata: { orderId: placed.orderId, storeId: store.id },
      payment_intent_data: { metadata: { orderId: placed.orderId, storeId: store.id }, description: reference },
      success_url: `${back}?paid=1`,
      cancel_url: back,
      expires_at: Math.floor(Date.now() / 1000) + OPEN_MINUTES * 60,
      locale: STRIPE_LOCALES[store.locale] ?? "auto",
    },
    `order-${placed.orderId}`,
  );
  if (!session.url) throw new Error("no payment page");
  await withTenant(store.organizationId, async (tx) => {
    await tx.update(orders).set({ paymentReference: session.id, updatedAt: new Date() }).where(eq(orders.id, placed.orderId));
    await event(tx, store.organizationId, placed.orderId, "paymentStarted", { provider: "stripe" });
  });
  return session.url;
}

type After = { problem?: { orderId: string; number: number; kind: string }; paid?: { orderId: string; number: number; grossCents: number; email: string | null } };

/** One message from Stripe for this store: checked, applied once, answered. */
export async function handleShopStripeWebhook(storeId: string, payload: string, signature: string | null): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) throw new ShopPaymentError("UNKNOWN");
  const [row] = await getDb().select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!row) throw new ShopPaymentError("UNKNOWN");
  const { secretKey, webhookSecret } = storeSecrets(row);
  if (!secretKey || !webhookSecret || !signature) throw new ShopPaymentError("SIGNATURE");
  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = new Stripe(secretKey).webhooks.constructEvent(payload, signature, webhookSecret);
  } catch {
    throw new ShopPaymentError("SIGNATURE");
  }
  const ctx = await companyContext(row.organizationId);
  const [org] = await getDb().select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, row.organizationId));
  const after: After = {};
  const result = await withTenant(row.organizationId, async (tx) => {
    const [fresh] = await tx
      .insert(shopPaymentEvents)
      .values({ organizationId: row.organizationId, storeId, provider: "stripe", eventId: stripeEvent.id, type: stripeEvent.type, result: "received" })
      .onConflictDoNothing()
      .returning({ id: shopPaymentEvents.id });
    if (!fresh) return "duplicate";
    const outcome = await apply(tx, row.organizationId, storeId, stripeEvent, (org?.currency ?? "EUR").toLowerCase(), ctx, after);
    await tx.update(shopPaymentEvents).set({ result: outcome.result, orderId: outcome.orderId }).where(eq(shopPaymentEvents.id, fresh.id));
    return outcome.result;
  });

  if (after.problem || after.paid) {
    const store = await findStore(row.slug, ctx);
    if (after.problem) {
      await notify(row.organizationId, await companyLeads(row.organizationId), {
        category: "failure",
        kind: "shopPayment",
        vars: { number: after.problem.number, store: row.name },
        href: `/app/orders/${after.problem.orderId}`,
        entity: "order",
        entityId: after.problem.orderId,
        priority: 2,
        dedupeKey: `shop-payment:${stripeEvent.id}`,
      }).catch((e) => console.error("shop: notify failed", e instanceof Error ? e.message : e));
    }
    if (after.paid) await afterPayment(row.organizationId, after.paid.orderId).catch((e) => console.error("shop: supplier orders failed", e instanceof Error ? e.message : e));
    if (after.paid?.email && store) {
      await mailBuyer(store, after.paid.email, "paid", after.paid).catch((e) => console.error("shop: mail failed", e instanceof Error ? e.message : e));
    }
  }
  return result;
}

async function apply(
  tx: Tx,
  organizationId: string,
  storeId: string,
  stripeEvent: Stripe.Event,
  currency: string,
  ctx: Context | null,
  after: After,
): Promise<{ result: string; orderId: string | null }> {
  const orderOf = async (id: string | null | undefined) => {
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.storeId, storeId)))
      .for("update");
    return order ?? null;
  };

  switch (stripeEvent.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = stripeEvent.data.object as Stripe.Checkout.Session;
      const order = await orderOf(session.metadata?.orderId ?? session.client_reference_id);
      if (!order) return { result: "unknown order", orderId: null };
      if (session.payment_status !== "paid") {
        await event(tx, organizationId, order.id, "paymentPending", { provider: "stripe" });
        return { result: "pending", orderId: order.id };
      }
      const reference = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? session.id);
      if (session.amount_total !== order.grossCents || session.currency !== currency) {
        await event(tx, organizationId, order.id, "paymentMismatch", { provider: "stripe", expected: order.grossCents, received: session.amount_total, currency: session.currency, reference });
        after.problem = { orderId: order.id, number: order.number, kind: "mismatch" };
        return { result: "amount mismatch", orderId: order.id };
      }
      if (order.paymentStatus === "PAID") return { result: "already paid", orderId: order.id };
      if (order.fulfillmentStatus === "CANCELLED") {
        // Paid after it ran out: the money is there, the order is not — someone has to decide.
        await event(tx, organizationId, order.id, "paidAfterCancel", { provider: "stripe", reference, amount: session.amount_total });
        await tx.update(orders).set({ paymentReference: reference, updatedAt: new Date() }).where(eq(orders.id, order.id));
        after.problem = { orderId: order.id, number: order.number, kind: "late" };
        return { result: "paid after cancel", orderId: order.id };
      }
      const now = new Date();
      await tx.update(orders).set({ paymentStatus: "PAID", paidAt: now, paymentReference: reference, updatedAt: now }).where(eq(orders.id, order.id));
      await event(tx, organizationId, order.id, "markPaid", { provider: "stripe", reference, amount: session.amount_total });
      if (ctx) await audit(tx, ctx, "order.markPaid", "order", order.id, { provider: "stripe", reference }, "shop");
      after.paid = { orderId: order.id, number: order.number, grossCents: order.grossCents, email: session.customer_details?.email ?? session.customer_email ?? null };
      return { result: "paid", orderId: order.id };
    }
    case "checkout.session.async_payment_failed": {
      const session = stripeEvent.data.object as Stripe.Checkout.Session;
      const order = await orderOf(session.metadata?.orderId ?? session.client_reference_id);
      if (!order) return { result: "unknown order", orderId: null };
      await event(tx, organizationId, order.id, "paymentFailed", { provider: "stripe" });
      after.problem = { orderId: order.id, number: order.number, kind: "failed" };
      return { result: "failed", orderId: order.id };
    }
    case "checkout.session.expired": {
      const session = stripeEvent.data.object as Stripe.Checkout.Session;
      const order = await orderOf(session.metadata?.orderId ?? session.client_reference_id);
      if (!order) return { result: "unknown order", orderId: null };
      const cancelled = await cancelUnpaid(tx, organizationId, order.id, "expired");
      if (cancelled && ctx) await audit(tx, ctx, "order.cancel", "order", order.id, { provider: "stripe", reason: "expired" }, "shop");
      return { result: cancelled ? "expired" : "kept", orderId: order.id };
    }
    case "charge.refunded": {
      const charge = stripeEvent.data.object as Stripe.Charge;
      const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (!intent) return { result: "ignored", orderId: null };
      const [found] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.paymentReference, intent), eq(orders.storeId, storeId)))
        .limit(1);
      const order = await orderOf(found?.id);
      if (!order) return { result: "unknown order", orderId: null };
      if (charge.amount_refunded < charge.amount) {
        await event(tx, organizationId, order.id, "partialRefund", { provider: "stripe", amount: charge.amount_refunded });
        return { result: "partly refunded", orderId: order.id };
      }
      if (order.paymentStatus === "REFUNDED") return { result: "already refunded", orderId: order.id };
      await tx.update(orders).set({ paymentStatus: "REFUNDED", updatedAt: new Date() }).where(eq(orders.id, order.id));
      await event(tx, organizationId, order.id, "refund", { provider: "stripe", amount: charge.amount_refunded });
      if (ctx) await audit(tx, ctx, "order.refund", "order", order.id, { provider: "stripe" }, "shop");
      return { result: "refunded", orderId: order.id };
    }
    default:
      return { result: "ignored", orderId: null };
  }
}

/** For the store's settings page: where Stripe sends its messages. */
export function webhookUrl(storeId: string): string | null {
  const base = appUrl();
  return base ? `${base}/api/shop/stripe/${storeId}` : null;
}

export const formatShopMoney = (store: PublicStore, cents: number) => formatMoney(cents, store.locale, { country: store.country, currency: store.currency });
