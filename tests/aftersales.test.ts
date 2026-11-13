import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { orders, organizations, products, returns, shipments } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { canMove, lineGrossCents, returnableUntil } from "@/lib/returns";
import { carrierOf, problemOf, trackingUrl } from "@/lib/shipping";
import { contextFor, type Context } from "@/server/context";
import { adjustStock } from "@/server/inventory";
import { openNotifications } from "@/server/notifications";
import { runOrderAction } from "@/server/order-flow";
import { saveProduct } from "@/server/products";
import { refundOrder, refundsOf, markRefundSent, type StripeRefund } from "@/server/refunds";
import { createReturn, getReturn, moveReturn, openSupplierReturns, requestReturn, returnableLines } from "@/server/returns";
import { addShipmentEvent, checkShipments, shipmentsOf, syncDhl, type TrackFetch } from "@/server/shipments";
import { findStore, placeOrder, type PublicStore } from "@/server/storefront";
import { createStore, savePages, savePayments, saveShippingOptions, setStoreStatus } from "@/server/stores";
import { newCompany, newMember } from "./helpers";

const DAY = 86_400_000;
const yes = async () => true;
const fresh = async (ctx: Context) => (await contextFor(ctx.user))!;

/** A store that sold a lamp to Eva, paid by transfer; returns the order and the buyer's token. */
async function sold(name: string) {
  const ctx = await newCompany(name);
  await getDb()
    .update(organizations)
    .set({ street: "Hauptstr. 1", postalCode: "10115", city: "Berlin", email: "shop@example.org", iban: "DE89370400440532013000", bic: "COBADEFFXXX" })
    .where(eq(organizations.id, ctx.organization.id));
  const owner = await fresh(ctx);
  const lamp = await saveProduct(owner, { kind: "PRODUCT", name: "Lampe", sku: "L1", priceCents: 1000, vatRate: 19, trackStock: true });
  await adjustStock(owner, lamp.id, { counted: 5 });
  const created = await createStore(owner, { name });
  await saveShippingOptions(owner, created.id, [{ name: "DHL", priceCents: 490, freeFromCents: null }]);
  await savePages(owner, created.id, { imprint: "Firma", privacy: "Daten", terms: "AGB", withdrawal: "Widerruf" });
  await savePayments(owner, created.id, { bank: true, stripe: false }, yes);
  await setStoreStatus(owner, created.id, "PUBLISHED");
  const store = (await findStore(created.slug))!;
  const placed = await placeOrder(store, {
    items: [{ productId: lamp.id, variantId: null, quantity: 2 }],
    email: "eva@example.org",
    shipping: { firstName: "Eva", lastName: "Muster", street: "Weg 1", postalCode: "20095", city: "Hamburg", country: "DE" },
    shippingId: store.shipping[0].id,
    payment: "bank",
    acceptTerms: true,
  });
  return { ctx: owner, store, lamp, orderId: placed.orderId, token: placed.token, grossCents: placed.grossCents };
}

async function stock(ctx: Context, productId: string) {
  const [p] = await withTenant(ctx.organization.id, (tx) => tx.select({ n: products.stockQuantity }).from(products).where(eq(products.id, productId)));
  return Number(p.n);
}

describe("shipping and return rules", () => {
  it("links carriers' tracking pages, names problems and counts the return period", () => {
    expect(carrierOf("DHL Paket")).toBe("dhl");
    expect(carrierOf("Spedition Müller")).toBe("other");
    expect(trackingUrl("dhl", "00340434161234567890")).toContain("piececode=00340434161234567890");
    expect([trackingUrl("other", "123456"), trackingUrl("dhl", "<script>")]).toEqual([null, null]);
    const now = new Date("2026-11-20T12:00:00Z");
    const shipped = (days: number) => new Date(now.getTime() - days * DAY);
    expect(problemOf({ status: "IN_TRANSIT", trackingNumber: null, shippedAt: shipped(2) }, now)).toBe("MISSING_TRACKING");
    expect(problemOf({ status: "IN_TRANSIT", trackingNumber: "123456", shippedAt: shipped(8) }, now)).toBe("DELAYED");
    expect(problemOf({ status: "IN_TRANSIT", trackingNumber: "123456", shippedAt: shipped(2) }, now)).toBeNull();
    expect(problemOf({ status: "LOST", trackingNumber: "123456", shippedAt: shipped(1) }, now)).toBe("LOST");
    expect(problemOf({ status: "DELIVERED", trackingNumber: null, shippedAt: shipped(30) }, now)).toBeNull();

    const order = { deliveredAt: new Date("2026-11-01T00:00:00Z"), shippedAt: null };
    expect(returnableUntil({ returnable: true, returnDays: null }, order)?.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(returnableUntil({ returnable: true, returnDays: 7 }, order)?.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(returnableUntil({ returnable: true, returnDays: 30 }, order)?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(returnableUntil({ returnable: false, returnDays: 30 }, order)).toBeNull();
    expect([canMove("REQUESTED", "APPROVED"), canMove("REQUESTED", "REFUNDED"), canMove("RECEIVED", "CLOSED"), canMove("CLOSED", "CLOSED")]).toEqual([true, false, true, false]);
    expect(lineGrossCents({ netCents: 2000, quantity: 2, vatRate: 19 }, 1, false)).toBe(1190);
  });
});

describe("shipments", () => {
  it("records the parcel when the order ships, completes the order when it arrives, and reports problems once", async () => {
    const { ctx, orderId } = await sold("Versand GmbH");
    await runOrderAction(ctx, orderId, "ship", { carrier: "DHL", trackingNumber: null });
    const [parcel] = await shipmentsOf(ctx, orderId);
    expect(parcel).toMatchObject({ carrier: "dhl", status: "IN_TRANSIT", trackingNumber: null, trackingUrl: null });

    // Two days later still without a number: told once, however often it is checked.
    const later = new Date(Date.now() + 2 * DAY);
    await checkShipments(ctx.organization.id, later);
    await checkShipments(ctx.organization.id, later);
    expect((await shipmentsOf(ctx, orderId))[0].problem).toBe("MISSING_TRACKING");
    const notes = (await openNotifications(await fresh(ctx))).filter((n) => n.kind === "shipmentMissingTracking");
    expect(notes).toHaveLength(1);

    await addShipmentEvent(ctx, parcel.id, { status: "DELIVERED", location: "Hamburg" });
    const [order] = await withTenant(ctx.organization.id, (tx) => tx.select().from(orders).where(eq(orders.id, orderId)));
    expect(order.fulfillmentStatus).toBe("DELIVERED");
    expect((await shipmentsOf(ctx, orderId))[0]).toMatchObject({ status: "DELIVERED", problem: null });
  });

  it("takes DHL's own events once, only with a key", async () => {
    const { ctx, orderId } = await sold("DHL GmbH");
    await runOrderAction(ctx, orderId, "ship", { carrier: "DHL", trackingNumber: "00340434161234567890" });
    const answer = {
      shipments: [
        {
          status: { statusCode: "transit" },
          events: [
            { timestamp: "2026-11-13T08:00:00Z", statusCode: "transit", description: "Die Sendung wurde im Start-Paketzentrum bearbeitet.", location: { address: { addressLocality: "Berlin" } } },
            { timestamp: "2026-11-12T18:00:00Z", statusCode: "pre-transit", description: "Elektronisch angekündigt" },
          ],
        },
      ],
    };
    const seen: string[] = [];
    const fetcher: TrackFetch = async (url, init) => {
      seen.push(`${url}|${init.headers["DHL-API-Key"]}`);
      return { ok: true, status: 200, json: async () => answer };
    };
    expect(await syncDhl(new Date(), fetcher, undefined)).toBe(0);
    expect(seen).toEqual([]);
    await syncDhl(new Date(), fetcher, "test-key");
    await withTenant(ctx.organization.id, (tx) => tx.update(shipments).set({ syncedAt: null }).where(eq(shipments.orderId, orderId)));
    await syncDhl(new Date(), fetcher, "test-key");
    expect(seen[0]).toContain("trackingNumber=00340434161234567890|test-key");
    const [parcel] = await shipmentsOf(ctx, orderId);
    expect(parcel.events.filter((e) => e.source === "carrier").map((e) => e.location)).toEqual(["Berlin", null]);
  });
});

describe("returns and refunds", () => {
  it("lets the buyer ask within the rules and the company take the goods back on the shelf", async () => {
    const { ctx, store, lamp, orderId, token } = await sold("Retoure GmbH");
    const buyerStore: PublicStore = store;
    await expect(requestReturn(buyerStore, token, { lines: [{ orderItemId: "00000000-0000-0000-0000-000000000000", quantity: 1 }], reason: "DAMAGED" })).rejects.toMatchObject({ code: "NOT_SHIPPED" });

    await runOrderAction(ctx, orderId, "ship", { carrier: "DHL", trackingNumber: "00340434161234567890" });
    expect(await stock(ctx, lamp.id)).toBe(3);
    const [line] = await returnableLines(ctx, orderId);
    expect(line).toMatchObject({ quantity: 2, left: 2, allowed: true, unitGrossCents: 1190 });

    await expect(requestReturn(buyerStore, token, { lines: [{ orderItemId: line.orderItemId, quantity: 3 }], reason: "DAMAGED" })).rejects.toMatchObject({ code: "QUANTITY" });
    const { number } = await requestReturn(buyerStore, token, { lines: [{ orderItemId: line.orderItemId, quantity: 1 }], reason: "DAMAGED", description: "Glas gesprungen" });
    expect(number).toBe(1);
    expect((await returnableLines(ctx, orderId))[0].left).toBe(1);
    expect((await openNotifications(await fresh(ctx))).map((n) => n.kind)).toContain("returnRequested");

    const found = (await withTenant(ctx.organization.id, (tx) => tx.select().from(returns)))[0];
    expect(found).toMatchObject({ status: "REQUESTED", channel: "shop", refundCents: 1190 });
    await expect(moveReturn(ctx, found.id, "RECEIVED")).rejects.toMatchObject({ code: "STEP" });
    await moveReturn(ctx, found.id, "APPROVED");
    await moveReturn(ctx, found.id, "SHIPPED");
    await moveReturn(ctx, found.id, "RECEIVED");
    const detail = await getReturn(ctx, found.id);
    await moveReturn(ctx, found.id, "INSPECTION", { inspection: [{ itemId: detail.items[0].id, condition: "AS_NEW", restock: 1 }] });
    // Inspecting again books nothing twice.
    await moveReturn(ctx, found.id, "REFUND_PENDING", { inspection: [{ itemId: detail.items[0].id, condition: "AS_NEW", restock: 1 }] });
    expect(await stock(ctx, lamp.id)).toBe(4);
    expect(await openSupplierReturns(ctx, found.id).catch((e) => e.code)).toBe("NO_SUPPLIER");

    // After the period only the company may still take goods back.
    await withTenant(ctx.organization.id, (tx) => tx.update(orders).set({ deliveredAt: new Date(Date.now() - 20 * DAY) }).where(eq(orders.id, orderId)));
    await expect(requestReturn(buyerStore, token, { lines: [{ orderItemId: line.orderItemId, quantity: 1 }], reason: "CHANGED_MIND" })).rejects.toMatchObject({ code: "WINDOW" });
    const late = await createReturn(ctx, orderId, { lines: [{ orderItemId: line.orderItemId, quantity: 1 }], reason: "DEFECTIVE" });
    expect((await getReturn(ctx, late.id)).ret.status).toBe("APPROVED");
  });

  it("refunds only what was paid, by transfer once sent, through Stripe at once, and never twice", async () => {
    const { ctx, store, orderId, token, grossCents } = await sold("Geld GmbH");
    await runOrderAction(ctx, orderId, "ship", { carrier: "DHL", trackingNumber: "00340434161234567890" });
    await expect(refundOrder(ctx, orderId, { amountCents: 100, provider: "bank" })).rejects.toMatchObject({ code: "NOT_PAID" });
    await runOrderAction(ctx, orderId, "markPaid");

    const [line] = await returnableLines(ctx, orderId);
    await requestReturn(store, token, { lines: [{ orderItemId: line.orderItemId, quantity: 1 }], reason: "DEFECTIVE" });
    const ret = (await withTenant(ctx.organization.id, (tx) => tx.select().from(returns)))[0];
    for (const step of ["APPROVED", "RECEIVED", "REFUND_PENDING"] as const) await moveReturn(ctx, ret.id, step);

    const employee = await newMember(ctx, "EMPLOYEE");
    await expect(refundOrder(employee, orderId, { amountCents: 100, provider: "bank" })).rejects.toThrow();
    await expect(refundOrder(ctx, orderId, { amountCents: grossCents + 1, provider: "bank" })).rejects.toMatchObject({ code: "AMOUNT" });
    await expect(refundOrder(ctx, orderId, { amountCents: 100, provider: "stripe" })).rejects.toMatchObject({ code: "PROVIDER" });

    const bank = await refundOrder(ctx, orderId, { amountCents: 1190, provider: "bank", returnId: ret.id });
    expect(bank.status).toBe("PENDING");
    expect((await refundsOf(ctx, orderId)).leftCents).toBe(grossCents - 1190);
    await markRefundSent(ctx, bank.id, { reference: "Überweisung 13.11." });
    expect((await getReturn(ctx, ret.id)).ret.status).toBe("REFUNDED");
    const [paid] = await withTenant(ctx.organization.id, (tx) => tx.select().from(orders).where(eq(orders.id, orderId)));
    expect(paid.paymentStatus).toBe("PARTIALLY_REFUNDED");
    await expect(markRefundSent(ctx, bank.id, {})).rejects.toMatchObject({ code: "STATE" });

    // Paid online: the rest goes back through the store's Stripe account, keyed by the refund.
    await savePayments(ctx, store.id, { bank: true, stripe: true, secretKey: "sk_test_51NexoraTestKey0000000000", webhookSecret: "whsec_testsecret0000000000000000" }, yes);
    await withTenant(ctx.organization.id, (tx) => tx.update(orders).set({ paymentMethod: "stripe", paymentReference: "pi_test_123" }).where(eq(orders.id, orderId)));
    const calls: { key: string; amount: number; intent: string }[] = [];
    const stripe: StripeRefund = async (key, p) => {
      calls.push({ key: p.idempotencyKey, amount: p.amountCents, intent: p.paymentIntent });
      return { id: "re_test_1", status: "succeeded" };
    };
    await refundOrder(ctx, orderId, { amountCents: grossCents - 1190, provider: "stripe" }, stripe);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ amount: grossCents - 1190, intent: "pi_test_123" });
    const [done] = await withTenant(ctx.organization.id, (tx) => tx.select().from(orders).where(eq(orders.id, orderId)));
    expect(done.paymentStatus).toBe("REFUNDED");
    expect((await refundsOf(ctx, orderId)).leftCents).toBe(0);
    // Fully refunded: no longer paid, nothing more to give back.
    await expect(refundOrder(ctx, orderId, { amountCents: 1, provider: "manual" })).rejects.toMatchObject({ code: "NOT_PAID" });
  });
});
