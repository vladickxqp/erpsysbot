/**
 * Subscriptions and what a company may use.
 *
 * Without STRIPE_SECRET_KEY billing is off: every company has everything
 * (self-hosted use). With it, the plan decides users, assistant questions and
 * modules; the state comes only from Stripe webhooks (verified signature),
 * never from the browser.
 */
import Stripe from "stripe";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { billingEvents, memberships, organizations, plans, subscriptions, suspensions } from "@/db/schema";
import { isBlockedCountry } from "@/lib/countries";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export const TRIAL_DAYS = 14;

/** The price list for visitors: what can be booked, in the order of the list. */
export async function publicPlans(): Promise<Plan[]> {
  return getDb().select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.position));
}
export const MODULES = ["crm", "orders", "calendar", "invoices", "finance", "team", "telegram", "assistant", "reports", "tasks", "documents", "inventory", "automation"] as const;
export type Module = (typeof MODULES)[number];

export class BillingError extends Error {
  constructor(public readonly code: "OFF" | "NO_PRICE" | "USER_LIMIT" | "NO_CUSTOMER") {
    super(code);
  }
}

const env = (name: string) => (process.env[name] ?? "").trim() || null;

export function billingEnabled(): boolean {
  return env("STRIPE_SECRET_KEY") !== null;
}

let stripe: Stripe | null = null;
function client(): Stripe {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new BillingError("OFF");
  stripe ??= new Stripe(key);
  return stripe;
}

/** A new company starts a trial of Business. */
export async function startTrial(organizationId: string): Promise<void> {
  await getDb()
    .insert(subscriptions)
    .values({ organizationId, planId: "business", status: "TRIALING", trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000) })
    .onConflictDoNothing();
}

export async function subscriptionOf(organizationId: string): Promise<{ sub: Subscription | null; plan: Plan | null }> {
  const [row] = await getDb()
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.organizationId, organizationId));
  return { sub: row?.sub ?? null, plan: row?.plan ?? null };
}

export function isActive(sub: Subscription | null, at = new Date()): boolean {
  if (!sub) return false;
  if (sub.status === "ACTIVE" || sub.status === "PAST_DUE") return true;
  return sub.status === "TRIALING" && !!sub.trialEndsAt && sub.trialEndsAt > at;
}

/** Which plan module a permission belongs to. */
export const PLAN_MODULE_OF: Record<string, string> = {
  clients: "crm",
  orders: "orders",
  products: "orders",
  invoices: "invoices",
  finance: "finance",
  employees: "team",
  ai: "assistant",
  calendar: "calendar",
  tasks: "tasks",
  documents: "documents",
  inventory: "inventory",
  automation: "automation",
};

export type Entitlements = { active: boolean; unlimited: boolean; modules: Set<string>; maxUsers: number; aiPerDay: number; plan: Plan | null; sub: Subscription | null };

export async function entitlementsOf(organizationId: string): Promise<Entitlements> {
  if (!billingEnabled()) return { active: true, unlimited: true, modules: new Set(MODULES), maxUsers: Infinity, aiPerDay: Infinity, plan: null, sub: null };
  const { sub, plan } = await subscriptionOf(organizationId);
  const active = isActive(sub);
  return {
    active,
    unlimited: false,
    modules: new Set(active ? (plan?.modules ?? []) : []),
    maxUsers: plan?.maxUsers ?? 1,
    aiPerDay: active ? (plan?.aiPerDay ?? 0) : 0,
    plan,
    sub,
  };
}

/** Members plus open invitations may not exceed the plan. */
export async function assertSeat(organizationId: string, pendingInvites: number): Promise<void> {
  const ent = await entitlementsOf(organizationId);
  if (ent.unlimited) return;
  const members = await getDb().select({ id: memberships.id }).from(memberships).where(eq(memberships.organizationId, organizationId));
  if (members.length + pendingInvites >= ent.maxUsers) throw new BillingError("USER_LIMIT");
}

// --- Stripe -----------------------------------------------------------------------------------

export async function checkoutUrl(ctx: Context, planId: string, base: string): Promise<string> {
  requirePermission(ctx.permissions, "billing.manage");
  const [plan] = await getDb().select().from(plans).where(eq(plans.id, planId));
  if (!plan?.stripePriceId || !plan.active) throw new BillingError("NO_PRICE");
  const { sub } = await subscriptionOf(ctx.organization.id);
  const s = client();
  let customer = sub?.stripeCustomerId ?? null;
  if (!customer) {
    const created = await s.customers.create({ name: ctx.organization.name, email: ctx.organization.email ?? ctx.user.email, metadata: { organizationId: ctx.organization.id } });
    customer = created.id;
    await getDb()
      .insert(subscriptions)
      .values({ organizationId: ctx.organization.id, stripeCustomerId: customer, status: "NONE" })
      .onConflictDoUpdate({ target: subscriptions.organizationId, set: { stripeCustomerId: customer } });
  }
  // A running subscription changes plan in the portal, not by a second checkout.
  if (sub?.stripeSubscriptionId && (sub.status === "ACTIVE" || sub.status === "PAST_DUE")) return portalUrl(ctx, base);
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: ctx.organization.id,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    subscription_data: { metadata: { organizationId: ctx.organization.id, planId } },
    metadata: { organizationId: ctx.organization.id, planId },
    success_url: `${base}/app/billing?done=1`,
    cancel_url: `${base}/app/billing`,
  });
  return session.url!;
}

export async function portalUrl(ctx: Context, base: string): Promise<string> {
  requirePermission(ctx.permissions, "billing.manage");
  const { sub } = await subscriptionOf(ctx.organization.id);
  if (!sub?.stripeCustomerId) throw new BillingError("NO_CUSTOMER");
  const session = await client().billingPortal.sessions.create({ customer: sub.stripeCustomerId, return_url: `${base}/app/billing` });
  return session.url;
}

const STATUS: Record<string, Subscription["status"]> = {
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  unpaid: "PAST_DUE",
  canceled: "CANCELED",
  incomplete: "NONE",
  incomplete_expired: "CANCELED",
  paused: "CANCELED",
};

/** Verifies and applies one webhook call; an event id is applied once. */
export async function handleStripeWebhook(payload: string, signature: string | null): Promise<"ok" | "duplicate" | "ignored"> {
  const secret = env("STRIPE_WEBHOOK_SECRET");
  if (!secret || !signature) throw new BillingError("OFF");
  const event = client().webhooks.constructEvent(payload, signature, secret);
  const db = getDb();
  const seen = await db.insert(billingEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning({ id: billingEvents.id });
  if (!seen.length) return "duplicate";

  if (event.type.startsWith("customer.subscription.")) {
    const sub = event.data.object as Stripe.Subscription;
    const organizationId = sub.metadata?.organizationId;
    if (!organizationId) return "ignored";
    const priceId = sub.items.data[0]?.price?.id ?? null;
    const [plan] = priceId ? await db.select({ id: plans.id }).from(plans).where(eq(plans.stripePriceId, priceId)) : [];
    const periodEnd = sub.items.data[0]?.current_period_end;
    await db
      .insert(subscriptions)
      .values({
        organizationId,
        planId: plan?.id ?? sub.metadata?.planId ?? null,
        status: event.type === "customer.subscription.deleted" ? "CANCELED" : (STATUS[sub.status] ?? "NONE"),
        trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        stripeSubscriptionId: sub.id,
      })
      .onConflictDoUpdate({
        target: subscriptions.organizationId,
        set: {
          planId: plan?.id ?? sub.metadata?.planId ?? null,
          status: event.type === "customer.subscription.deleted" ? "CANCELED" : (STATUS[sub.status] ?? "NONE"),
          trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          stripeSubscriptionId: sub.id,
          updatedAt: new Date(),
        },
      });
    await db.update(billingEvents).set({ organizationId }).where(eq(billingEvents.id, event.id));
    return "ok";
  }
  // A card issued in a closed country: the company waits for the platform admin's review.
  if (event.type === "payment_method.attached") {
    const method = event.data.object as Stripe.PaymentMethod;
    const customer = typeof method.customer === "string" ? method.customer : method.customer?.id;
    const [owner] = customer ? await db.select({ id: subscriptions.organizationId }).from(subscriptions).where(eq(subscriptions.stripeCustomerId, customer)) : [];
    const country = method.card?.country ?? null;
    if (owner && isBlockedCountry(country)) {
      await db.insert(suspensions).values({ organizationId: owner.id, kind: "REVIEW", reason: `card ${country}` }).onConflictDoNothing();
    }
    await db.update(billingEvents).set({ organizationId: owner?.id ?? null }).where(eq(billingEvents.id, event.id));
    return "ok";
  }
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const customer = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    const [owner] = customer ? await db.select({ id: subscriptions.organizationId }).from(subscriptions).where(eq(subscriptions.stripeCustomerId, customer)) : [];
    await db.update(billingEvents).set({ organizationId: owner?.id ?? null, amountCents: invoice.amount_paid ?? null }).where(eq(billingEvents.id, event.id));
    return "ok";
  }
  return "ignored";
}

export async function paymentHistory(ctx: Context) {
  requirePermission(ctx.permissions, "billing.manage");
  return getDb()
    .select({ id: billingEvents.id, type: billingEvents.type, amountCents: billingEvents.amountCents, createdAt: billingEvents.createdAt })
    .from(billingEvents)
    .where(eq(billingEvents.organizationId, ctx.organization.id))
    .orderBy(desc(billingEvents.createdAt))
    .limit(50)
    .then((rows) => rows.filter((r) => r.type.startsWith("invoice.")));
}

export async function companyName(organizationId: string): Promise<string | null> {
  const [row] = await getDb().select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId));
  return row?.name ?? null;
}
