/**
 * Talking to suppliers: sending supplier orders (by e-mail or to the
 * supplier's interface), the supplier's answers coming back, and the clock
 * that tries again after a passing failure.
 *
 * Every order carries its own key (Idempotency-Key): a retry is the same order,
 * never a second one. Claiming happens in a transaction, the call outside of
 * it, the result in another one; a claim that never came back is taken up
 * again after ten minutes with the same key. Both ways are signed with the
 * supplier's secret (HMAC-SHA256 over "timestamp.body"); a message whose
 * signature or time does not fit is not read.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { and, asc, eq, lte, ne, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { orderEvents, orders, productSuppliers, supplierOrderItems, supplierOrders, suppliers } from "@/db/schema";
import { MESSAGES, translator } from "@/i18n";
import { canDoSupplier, INBOUND_ACTION, INBOUND_EVENTS, isAllowedUrl, isPublicAddress, nextTry, STATUS_AFTER, type SubmitMethod, type SupplierOrderStatus } from "@/lib/dropship";
import { companyContext } from "./automations";
import type { Context } from "./context";
import { afterAction, applySupplierAction, callbackUrl, companyOf, evaluate, followUp, recordSupplierPrice, tellPriceChange, type Actor, type Company, type PriceChange } from "./dropship";
import { deliverMail, mailAvailable } from "./mail";
import { NotFoundError } from "./clients";
import { requirePermission } from "./permissions";
import { unseal } from "./secret-box";

type Transport = { fetch: typeof fetch; lookup: (host: string) => Promise<string[]> };

const realTransport: Transport = {
  fetch: (input, init) => fetch(input, init),
  lookup: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
};
let transport = realTransport;

/** Tests replace the network; null puts the real one back. */
export function setSupplierTransport(fake: Partial<Transport> | null): void {
  transport = fake ? { ...realTransport, ...fake } : realTransport;
}

export const sign = (secret: string, timestamp: string, body: string) => createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

/** Signed with this secret, within five minutes of now. */
export function verifySignature(secret: string, timestamp: string | null, body: string, signature: string | null, now = Date.now()): boolean {
  if (!timestamp || !signature || !/^\d{9,11}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(sign(secret, timestamp, body), "utf8");
  const given = Buffer.from(signature.replace(/^sha256=/, ""), "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Outcome =
  | { kind: "ok"; externalRef: string | null; answer: "confirmed" | "rejected" | "out_of_stock" | null; status: number | null }
  | { kind: "retry"; error: string; status: number | null }
  | { kind: "fail"; error: string; status: number | null };

type SupplierRow = typeof suppliers.$inferSelect;

/** Calls the supplier's interface; the address must lead outside the server's own network. */
async function callApi(supplier: SupplierRow, body: unknown, idempotencyKey: string | null): Promise<Outcome> {
  const url = supplier.apiUrl;
  if (!url || !isAllowedUrl(url)) return { kind: "fail", error: "URL", status: null };
  let addresses: string[];
  try {
    addresses = await transport.lookup(new URL(url).hostname.replace(/^\[|\]$/g, ""));
  } catch {
    return { kind: "retry", error: "UNAVAILABLE", status: null };
  }
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a))) return { kind: "fail", error: "URL", status: null };
  const secret = unseal(supplier.signingSecret);
  if (!secret) return { kind: "fail", error: "SETUP", status: null };
  const payload = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const apiKey = unseal(supplier.apiKey);
  let res: Response;
  try {
    res = await transport.fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "content-type": "application/json",
        "user-agent": "NEXORA-ONE",
        "x-nexora-timestamp": timestamp,
        "x-nexora-signature": sign(secret, timestamp, payload),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: payload,
    });
  } catch {
    return { kind: "retry", error: "UNAVAILABLE", status: null };
  }
  const raw = await res.text().catch(() => "");
  let answer: { reference?: unknown; orderId?: unknown; id?: unknown; status?: unknown } = {};
  try {
    answer = JSON.parse(raw);
  } catch {
    answer = {};
  }
  const ref = [answer.reference, answer.orderId, answer.id].find((v) => typeof v === "string" || typeof v === "number");
  const externalRef = ref === undefined ? null : String(ref).slice(0, 120);
  // 409: the supplier already has an order with this key, i.e. ours from an earlier try.
  if (res.ok || res.status === 409) {
    const status = typeof answer.status === "string" ? answer.status.toLowerCase() : "";
    return { kind: "ok", externalRef, answer: status === "confirmed" || status === "rejected" || status === "out_of_stock" ? status : null, status: res.status };
  }
  if (res.status === 401 || res.status === 403) return { kind: "fail", error: "CREDENTIALS", status: res.status };
  if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) return { kind: "retry", error: "UNAVAILABLE", status: res.status };
  return { kind: "fail", error: "REQUEST", status: res.status };
}

type Claim = {
  so: typeof supplierOrders.$inferSelect;
  supplier: SupplierRow;
  order: typeof orders.$inferSelect;
  items: (typeof supplierOrderItems.$inferSelect)[];
};

/** German for suppliers in German-speaking countries, English for everyone else. */
const supplierLocale = (country: string) => (["DE", "AT", "CH", "LI", "LU"].includes(country) ? "de" : "en");

function mailOf(claim: Claim, company: Company) {
  const t = translator(MESSAGES[supplierLocale(claim.supplier.country)]);
  const qty = (n: string) => String(Number(n));
  const lines = [
    t("dropship.mail.greeting"),
    "",
    t("dropship.mail.intro"),
    "",
    ...claim.items.map((i) => `${qty(i.quantity)} × ${i.supplierSku ? `${i.supplierSku} – ` : ""}${i.description}`),
    "",
    `${t("dropship.mail.shipTo")}:`,
    claim.order.shipName,
    claim.order.shipStreet,
    `${claim.order.shipPostalCode} ${claim.order.shipCity}`,
    claim.order.shipCountry,
    "",
    `${t("dropship.mail.reference")}: ${claim.so.idempotencyKey}`,
    t("dropship.mail.confirm"),
    "",
    company.name,
  ];
  return {
    to: claim.supplier.orderEmail ?? claim.supplier.email ?? "",
    subject: t("dropship.mail.subject", { reference: `${claim.so.number}`, company: company.name }),
    text: lines.filter((l) => l !== null).join("\n"),
    replyTo: company.email ?? undefined,
  };
}

async function sendMail(claim: Claim, company: Company): Promise<Outcome> {
  if (!mailAvailable()) return { kind: "fail", error: "NO_MAIL", status: null };
  const mail = mailOf(claim, company);
  if (!mail.to) return { kind: "fail", error: "SETUP", status: null };
  try {
    await deliverMail(mail);
    return { kind: "ok", externalRef: null, answer: null, status: null };
  } catch {
    return { kind: "retry", error: "MAIL", status: null };
  }
}

function orderPayload(claim: Claim, company: Company) {
  return {
    type: "order.create",
    reference: claim.so.idempotencyKey,
    number: claim.so.number,
    buyer: company.name,
    currency: claim.so.currency,
    lines: claim.items.map((i) => ({ sku: i.supplierSku, name: i.description, quantity: Number(i.quantity), unitCostCents: i.unitCostCents })),
    // What the supplier needs to ship, nothing more: no e-mail, no phone of the customer.
    shipTo: { name: claim.order.shipName, street: claim.order.shipStreet, postalCode: claim.order.shipPostalCode, city: claim.order.shipCity, country: claim.order.shipCountry },
    callbackUrl: callbackUrl(claim.supplier.id),
  };
}

const STALE_MS = 10 * 60_000;

/**
 * Sends one supplier order if it may go out now: checked against the rules and
 * prices once more, claimed, sent, the result written down. Returns where it
 * ends up.
 */
export async function submitSupplierOrder(organizationId: string, id: string, now = new Date()): Promise<SupplierOrderStatus | null> {
  const company = await companyOf(organizationId);
  const claim = await withTenant(organizationId, async (tx): Promise<Claim | null> => {
    const [so] = await tx.select().from(supplierOrders).where(eq(supplierOrders.id, id)).for("update");
    if (!so || so.method === "MANUAL") return null;
    if (so.status === "READY") {
      if ((await evaluate(tx, company, id)) !== "READY") return null;
    } else if (!(so.status === "SENDING" && so.nextAttemptAt && so.nextAttemptAt <= now)) return null;
    // Until the result is written, nobody else sends it; a claim that never came back is taken up again later.
    const [claimed] = await tx
      .update(supplierOrders)
      .set({ status: "SENDING", attempts: so.attempts + 1, nextAttemptAt: new Date(now.getTime() + STALE_MS), updatedAt: now })
      .where(eq(supplierOrders.id, id))
      .returning();
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, so.supplierId));
    const [order] = await tx.select().from(orders).where(eq(orders.id, so.orderId));
    const items = await tx.select().from(supplierOrderItems).where(eq(supplierOrderItems.supplierOrderId, id)).orderBy(asc(supplierOrderItems.id));
    return { so: claimed, supplier, order, items };
  });
  if (!claim) {
    await followUp(organizationId, { ids: [id] });
    return null;
  }

  const outcome = claim.so.method === "EMAIL" ? await sendMail(claim, company) : await callApi(claim.supplier, orderPayload(claim, company), claim.so.idempotencyKey);

  const status = await withTenant(organizationId, async (tx) => {
    const [so] = await tx.select().from(supplierOrders).where(eq(supplierOrders.id, id)).for("update");
    // Marked as ordered by hand in the meantime: that stands.
    if (!so || so.status !== "SENDING") return (so?.status as SupplierOrderStatus) ?? null;
    const event = (kind: string, data: Record<string, unknown>) => tx.insert(orderEvents).values({ organizationId, orderId: so.orderId, kind, data, userId: null });
    if (outcome.kind === "ok") {
      const after: SupplierOrderStatus = outcome.answer === "confirmed" ? "CONFIRMED" : outcome.answer === "rejected" ? "REJECTED" : outcome.answer === "out_of_stock" ? "OUT_OF_STOCK" : "SUBMITTED";
      await tx
        .update(supplierOrders)
        .set({ status: after, submittedAt: now, confirmedAt: after === "CONFIRMED" ? now : null, externalRef: outcome.externalRef ?? so.externalRef, nextAttemptAt: null, lastError: null, updatedAt: now })
        .where(eq(supplierOrders.id, id));
      await tx.update(suppliers).set({ lastSubmitAt: now, lastSubmitOk: true, lastError: null }).where(eq(suppliers.id, so.supplierId));
      await event("supplier.submitted", { supplierOrderId: id, number: so.number, method: so.method, ...(outcome.externalRef ? { externalRef: outcome.externalRef } : {}) });
      if (after !== "SUBMITTED") await event(`supplier.${after === "CONFIRMED" ? "confirm" : after === "REJECTED" ? "reject" : "outOfStock"}`, { supplierOrderId: id, number: so.number });
      return after;
    }
    const again = outcome.kind === "retry" ? nextTry(so.attempts, now) : null;
    const error = outcome.status ? `${outcome.error} (${outcome.status})` : outcome.error;
    await tx
      .update(supplierOrders)
      .set({ status: again ? "SENDING" : "FAILED", nextAttemptAt: again, lastError: error, updatedAt: now })
      .where(eq(supplierOrders.id, id));
    await tx.update(suppliers).set({ lastSubmitAt: now, lastSubmitOk: false, lastError: error }).where(eq(suppliers.id, so.supplierId));
    if (!again) await event("supplier.failed", { supplierOrderId: id, number: so.number, error });
    return again ? "SENDING" : "FAILED";
  });
  if (status && status !== "SENDING") await afterAction(organizationId, { id, orderId: claim.so.orderId, status, order: null }).catch((e) => console.error("dropship: follow-up failed", e instanceof Error ? e.message : e));
  return status;
}

/** The clock: what may go out but did not (missed, or due again after a passing failure). */
export async function runSupplierOrders(now = new Date()): Promise<number> {
  const due = await getDb()
    .select({ id: supplierOrders.id, organizationId: supplierOrders.organizationId })
    .from(supplierOrders)
    .where(or(and(eq(supplierOrders.status, "READY"), ne(supplierOrders.method, "MANUAL")), and(eq(supplierOrders.status, "SENDING"), lte(supplierOrders.nextAttemptAt, now))))
    .orderBy(asc(supplierOrders.updatedAt))
    .limit(50);
  for (const row of due) await submitSupplierOrder(row.organizationId, row.id, now).catch((e) => console.error("dropship: send failed", e instanceof Error ? e.message : e));
  return due.length;
}

/** Tries the way orders go to this supplier without ordering anything. */
export async function testSupplierLink(ctx: Context, supplierId: string): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  requirePermission(ctx.permissions, "inventory.manage");
  const [supplier] = await withTenant(ctx.organization.id, (tx) => tx.select().from(suppliers).where(eq(suppliers.id, supplierId)));
  if (!supplier) throw new NotFoundError();
  const method = supplier.submitMethod as SubmitMethod;
  if (method === "MANUAL") return { ok: true, status: null, error: null };
  if (method === "EMAIL") {
    if (!mailAvailable()) return { ok: false, status: null, error: "NO_MAIL" };
    return supplier.orderEmail || supplier.email ? { ok: true, status: null, error: null } : { ok: false, status: null, error: "SETUP" };
  }
  const outcome = await callApi(supplier, { type: "ping", callbackUrl: callbackUrl(supplier.id) }, null);
  return outcome.kind === "ok" ? { ok: true, status: outcome.status, error: null } : { ok: false, status: outcome.status, error: outcome.error };
}

// --- The supplier's answers ------------------------------------------------------------------------

const inbound = z.object({
  type: z.enum(INBOUND_EVENTS),
  /** Our key for the order, as sent; or the supplier's own order number. */
  reference: z.string().trim().min(1).max(200).optional(),
  externalRef: z.string().trim().max(120).optional(),
  carrier: z.string().trim().max(80).optional(),
  trackingNumber: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
  items: z
    .array(z.object({ sku: z.string().trim().min(1).max(80), stock: z.number().min(0).max(1_000_000_000).optional(), priceCents: z.number().int().min(0).max(1_000_000_000).optional() }))
    .max(5000)
    .optional(),
});

export type InboundResult = { status: number; result: string };

/** A message from a supplier's system; only one signed with that supplier's secret is read. */
export async function handleSupplierEvent(supplierId: string, body: string, timestamp: string | null, signature: string | null): Promise<InboundResult> {
  if (!z.string().uuid().safeParse(supplierId).success) return { status: 404, result: "unknown supplier" };
  const [supplier] = await getDb().select().from(suppliers).where(eq(suppliers.id, supplierId));
  const secret = unseal(supplier?.signingSecret);
  if (!supplier || !secret || !supplier.dropship) return { status: 404, result: "unknown supplier" };
  if (!verifySignature(secret, timestamp, body, signature)) return { status: 401, result: "invalid signature" };
  let message: z.output<typeof inbound>;
  try {
    message = inbound.parse(JSON.parse(body));
  } catch {
    return { status: 400, result: "invalid message" };
  }
  const organizationId = supplier.organizationId;
  if (message.type === "ping") return { status: 200, result: "pong" };

  if (message.type === "stock.updated") {
    const items = (message.items ?? []).filter((i) => i.stock !== undefined);
    const updated = await withTenant(organizationId, async (tx) => {
      let n = 0;
      const now = new Date();
      for (const item of items) {
        const rows = await tx
          .update(productSuppliers)
          .set({ supplierStock: String(item.stock), stockReportedAt: now })
          .where(and(eq(productSuppliers.supplierId, supplierId), eq(productSuppliers.supplierSku, item.sku)))
          .returning({ id: productSuppliers.id });
        n += rows.length;
      }
      return n;
    });
    return { status: 200, result: `stock ${updated}` };
  }

  if (message.type === "price.updated") {
    const items = (message.items ?? []).filter((i) => i.priceCents !== undefined);
    const changes = await withTenant(organizationId, async (tx) => {
      const found: PriceChange[] = [];
      for (const item of items) {
        const offers = await tx
          .select({ id: productSuppliers.id })
          .from(productSuppliers)
          .where(and(eq(productSuppliers.supplierId, supplierId), eq(productSuppliers.supplierSku, item.sku)));
        for (const offer of offers) {
          const change = await recordSupplierPrice(tx, offer.id, item.priceCents!);
          if (change) found.push(change);
        }
      }
      return found;
    });
    for (const change of changes) await tellPriceChange(organizationId, change);
    return { status: 200, result: `prices ${changes.length}` };
  }

  const action = INBOUND_ACTION[message.type]!;
  if (!message.reference) return { status: 400, result: "reference missing" };
  const company = await companyOf(organizationId);
  const actor: Actor = { organizationId, userId: null, ctx: await companyContext(organizationId), via: "supplier" };
  const outcome = await withTenant(organizationId, async (tx) => {
    const [so] = await tx
      .select()
      .from(supplierOrders)
      .where(and(eq(supplierOrders.supplierId, supplierId), or(eq(supplierOrders.idempotencyKey, message.reference!), eq(supplierOrders.externalRef, message.reference!))))
      .limit(1);
    if (!so) return { status: 404, result: "unknown order" } as const;
    const target = STATUS_AFTER[action as Exclude<typeof action, "send">];
    // Suppliers repeat their messages: the same news twice changes nothing.
    if (so.status === target) return { status: 200, result: "duplicate" } as const;
    // An order still being sent counts as with the supplier once it answers about it.
    if (so.status === "SENDING") await tx.update(supplierOrders).set({ status: "SUBMITTED", submittedAt: new Date(), nextAttemptAt: null }).where(eq(supplierOrders.id, so.id));
    const from = (so.status === "SENDING" ? "SUBMITTED" : so.status) as SupplierOrderStatus;
    if (!canDoSupplier(action, from, so.method as SubmitMethod)) return { status: 409, result: `not possible from ${from}` } as const;
    const result = await applySupplierAction(tx, actor, company, so.id, action, {
      externalRef: message.externalRef,
      carrier: message.carrier,
      trackingNumber: message.trackingNumber,
      note: message.note,
    });
    return { status: 200, result: result.status.toLowerCase(), done: result } as const;
  });
  if ("done" in outcome && outcome.done) await afterAction(organizationId, outcome.done);
  return { status: outcome.status, result: outcome.result };
}
