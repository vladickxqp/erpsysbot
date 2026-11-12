import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { organizations, productSuppliers, suppliers, supplierOrders } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { canDoSupplier, cleanRules, DEFAULT_RULES, isAllowedUrl, isPublicAddress, linkState, nextTry, reasonsFor, supplierActionsFor } from "@/lib/dropship";
import { getProductDetail, saveOffer } from "@/server/catalog";
import { createClient, NotFoundError } from "@/server/clients";
import type { Context } from "@/server/context";
import {
  acknowledgePrice,
  companyOf,
  dropshipAvailable,
  dropshipOverview,
  evaluate,
  getDropshipSettings,
  listSupplierOrders,
  runSupplierAction,
  saveDropshipSettings,
  signingSecret,
  supplierOrderCounts,
  supplierOrdersOf,
  type DropshipInput,
} from "@/server/dropship";
import { saveSupplier } from "@/server/inventory";
import { setMailSender, type Mail } from "@/server/mail";
import { openNotifications } from "@/server/notifications";
import { getOrderFlow, runOrderAction, saveShipping } from "@/server/order-flow";
import { ForbiddenError } from "@/server/permissions";
import { createOrder } from "@/server/orders";
import { saveProduct } from "@/server/products";
import { createStore, getStore, savePages, savePayments, saveShippingOptions, setStoreStatus } from "@/server/stores";
import { findStore, placeOrder, priceCart } from "@/server/storefront";
import { handleSupplierEvent, runSupplierOrders, setSupplierTransport, sign, submitSupplierOrder, verifySignature } from "@/server/supplier-link";
import { newCompany, newMember } from "./helpers";

afterEach(() => {
  setSupplierTransport(null);
  setMailSender(null);
});

const rules = (patch: Partial<DropshipInput["rules"]> = {}): DropshipInput["rules"] => ({
  autoBelowCents: null,
  minMarginPercent: null,
  approveNewSupplier: true,
  approvePriceChange: true,
  approveUnknownStock: true,
  requirePaid: true,
  ...patch,
});

/** A company selling a bag its supplier ships straight to the customer. */
async function dropshipper(name: string, settings: Partial<DropshipInput> = {}) {
  const ctx = await newCompany(name);
  const client = await createClient(ctx, { lastName: "Kundin" });
  const bag = await saveProduct(ctx, { kind: "PRODUCT", name: "Tasche", sku: "T1", priceCents: 5000, vatRate: 19, fulfillment: "DROPSHIP" });
  const supplier = await saveSupplier(ctx, null, { name: "Taschen AG", email: "orders@taschen.example" });
  await saveDropshipSettings(ctx, supplier.id, { dropship: true, submitMethod: "MANUAL", rules: rules(), ...settings });
  const offer = await saveOffer(ctx, bag.id, null, { supplierId: supplier.id, supplierSku: "TA-9", purchasePriceCents: 2000, shippingCostCents: 300, preferred: true });
  return { ctx, client, bag, supplier, offer };
}

async function sold(ctx: Context, clientId: string, productId: string, quantity = 1, address = true) {
  const order = await createOrder(ctx, { clientId, items: [{ productId, description: "Tasche", quantity, unit: "Stk", unitPriceCents: 5000, vatRate: 19 }] });
  if (address) await saveShipping(ctx, order.id, { shipName: "Eva Muster", shipStreet: "Weg 1", shipPostalCode: "20095", shipCity: "Hamburg", shipCountry: "DE" });
  return order;
}

const only = async (ctx: Context, orderId: string) => (await supplierOrdersOf(ctx, orderId))[0];

/** A supplier interface that answers what the test says, and remembers what it was asked. */
function fakeSupplier(answer: (n: number) => Response | Promise<Response>) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  setSupplierTransport({
    lookup: async () => ["93.184.216.34"],
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      return answer(calls.length);
    }) as unknown as typeof fetch,
  });
  return calls;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function signed(ctx: Context, supplierId: string, message: unknown) {
  const secret = await signingSecret(ctx, supplierId);
  const body = JSON.stringify(message);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return handleSupplierEvent(supplierId, body, timestamp, sign(secret, timestamp, body));
}

describe("dropship rules", () => {
  it("names why a supplier order waits, and allows each step only from where it can come", () => {
    const base = { rules: DEFAULT_RULES, costCents: 2300, marginPercent: 50, doneOrders: 5, priceChanged: false, stock: [{ reported: 10, needed: 1 }], addressComplete: true };
    expect(reasonsFor(base)).toEqual(["MANUAL_RULE"]);
    expect(reasonsFor({ ...base, rules: { ...DEFAULT_RULES, autoBelowCents: 5000 } })).toEqual([]);
    expect(reasonsFor({ ...base, rules: { ...DEFAULT_RULES, autoBelowCents: 1000 } })).toEqual(["AMOUNT"]);
    expect(
      reasonsFor({ ...base, rules: { ...DEFAULT_RULES, autoBelowCents: 5000, minMarginPercent: 60 }, doneOrders: 0, priceChanged: true, stock: [{ reported: null, needed: 1 }, { reported: 0, needed: 2 }], addressComplete: false }),
    ).toEqual(["ADDRESS", "STOCK_SHORT", "STOCK_UNKNOWN", "PRICE", "MARGIN", "NEW_SUPPLIER"]);
    expect(reasonsFor({ ...base, rules: { ...DEFAULT_RULES, autoBelowCents: 5000, approveUnknownStock: false, approvePriceChange: false, approveNewSupplier: false }, doneOrders: 0, priceChanged: true, stock: [{ reported: null, needed: 1 }] })).toEqual([]);

    expect(supplierActionsFor("APPROVAL", "API")).toEqual(["approve", "cancel"]);
    expect(supplierActionsFor("READY", "MANUAL")).toEqual(["markSubmitted", "cancel"]);
    expect(supplierActionsFor("READY", "API")).toEqual(["send", "markSubmitted", "cancel"]);
    expect(supplierActionsFor("SUBMITTED", "EMAIL")).toEqual(["confirm", "reject", "outOfStock", "ship", "cancel"]);
    expect(canDoSupplier("deliver", "CONFIRMED", "API")).toBe(false);
    expect(canDoSupplier("retry", "OUT_OF_STOCK", "API")).toBe(true);
    expect(supplierActionsFor("DELIVERED", "API")).toEqual([]);

    const now = new Date("2026-11-12T10:00:00Z");
    expect([1, 2, 5, 6].map((n) => nextTry(n, now)?.toISOString() ?? null)).toEqual(["2026-11-12T10:01:00.000Z", "2026-11-12T10:05:00.000Z", "2026-11-12T16:00:00.000Z", null]);
    expect(cleanRules({ autoBelowCents: -5, minMarginPercent: 250, requirePaid: "yes" })).toEqual({ ...DEFAULT_RULES, minMarginPercent: 100 });
  });

  it("lets the app call only real addresses on the internet", () => {
    expect(["https://api.supplier.example/orders", "https://93.184.216.34/x"].map(isAllowedUrl)).toEqual([true, true]);
    expect(
      ["http://api.supplier.example", "https://localhost/x", "https://10.0.0.5/x", "https://192.168.1.1", "https://[::1]/", "https://user:pw@api.example.com", "https://intranet/x", "https://db.internal/x", "nonsense"].map(isAllowedUrl),
    ).toEqual([false, false, false, false, false, false, false, false, false]);
    expect(["8.8.8.8", "127.0.0.1", "172.20.1.1", "169.254.169.254", "100.64.0.1", "fd00::1", "2a00:1450::1"].map(isPublicAddress)).toEqual([true, false, false, false, false, false, true]);
    const s = { dropship: true, submitMethod: "API" as const, orderEmail: null, email: null, apiUrl: "https://x.example", lastSubmitAt: null, lastSubmitOk: null, mailReady: false };
    expect([linkState({ ...s, dropship: false }), linkState({ ...s, apiUrl: null }), linkState(s), linkState({ ...s, lastSubmitAt: new Date(), lastSubmitOk: true }), linkState({ ...s, lastSubmitAt: new Date(), lastSubmitOk: false })]).toEqual([
      "OFF",
      "SETUP",
      "CONFIGURED",
      "CONNECTED",
      "ERROR",
    ]);
    expect(linkState({ ...s, submitMethod: "EMAIL", email: "a@b.example" })).toBe("SETUP");
    const secret = "s3cret";
    const now = Date.now();
    const ts = String(Math.floor(now / 1000));
    expect(verifySignature(secret, ts, "{}", sign(secret, ts, "{}"), now)).toBe(true);
    expect(verifySignature(secret, ts, "{ }", sign(secret, ts, "{}"), now)).toBe(false);
    expect(verifySignature(secret, String(Math.floor(now / 1000) - 600), "{}", sign(secret, String(Math.floor(now / 1000) - 600), "{}"), now)).toBe(false);
  });
});

describe("a supplier's settings", () => {
  it("keeps the supplier's key encrypted, makes a signing secret, and lets only managers change them", async () => {
    const ctx = await newCompany("Schlüssel GmbH");
    const supplier = await saveSupplier(ctx, null, { name: "Api Lieferant" });
    await saveDropshipSettings(ctx, supplier.id, { dropship: true, submitMethod: "API", apiUrl: "https://api.lieferant.example/orders", apiKey: "sup_live_ABCDEFGH12345678", rules: rules({ autoBelowCents: 10_000 }) });
    const [row] = await withTenant(ctx.organization.id, (tx) => tx.select().from(suppliers).where(eq(suppliers.id, supplier.id)));
    expect(row.apiKey).not.toContain("ABCDEFGH");
    expect(row.signingSecret).toBeTruthy();
    const view = await getDropshipSettings(ctx, supplier.id);
    expect(view).toMatchObject({ dropship: true, submitMethod: "API", apiKeyHint: "sup_live_…5678", hasSecret: true, state: "CONFIGURED", rules: { autoBelowCents: 10_000 } });
    expect(JSON.stringify(view)).not.toContain("ABCDEFGH");

    // Saving again without a key keeps it; removing takes it away.
    await saveDropshipSettings(ctx, supplier.id, { dropship: true, submitMethod: "API", apiUrl: "https://api.lieferant.example/orders", rules: rules() });
    expect((await getDropshipSettings(ctx, supplier.id)).apiKeyHint).toBe("sup_live_…5678");
    const first = await signingSecret(ctx, supplier.id);
    expect(await signingSecret(ctx, supplier.id)).toBe(first);
    expect(await signingSecret(ctx, supplier.id, true)).not.toBe(first);
    await saveDropshipSettings(ctx, supplier.id, { dropship: true, submitMethod: "API", apiUrl: "https://api.lieferant.example/orders", removeApiKey: true, rules: rules() });
    expect((await getDropshipSettings(ctx, supplier.id)).apiKeyHint).toBeNull();

    await expect(saveDropshipSettings(ctx, supplier.id, { dropship: true, submitMethod: "API", apiUrl: "http://10.0.0.1/orders", rules: rules() })).rejects.toThrow();
    const seller = await newMember(ctx, "EMPLOYEE");
    await expect(saveDropshipSettings(seller, supplier.id, { dropship: false, submitMethod: "MANUAL", rules: rules() })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(signingSecret(seller, supplier.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("an order the supplier ships", () => {
  it("waits for the payment, asks for a yes, is ordered by hand, and carries the order to the customer", async () => {
    const { ctx, client, bag, supplier } = await dropshipper("Taschen Shop GmbH");
    const order = await sold(ctx, client.id, bag.id, 2);
    await runOrderAction(ctx, order.id, "confirm");
    let flow = await getOrderFlow(ctx, order.id);
    expect(flow.order.fulfillmentStatus).toBe("AT_SUPPLIER");
    expect(flow.dropOnly).toBe(true);
    let so = await only(ctx, order.id);
    expect(so).toMatchObject({ status: "WAITING", supplier: "Taschen AG", costCents: 4600, saleCents: 10_000, items: [{ supplierSku: "TA-9", quantity: 2, unitCostCents: 2000, shippingCostCents: 300 }] });

    // Nothing leaves before the customer paid; the warehouse cannot ship it either.
    await expect(runOrderAction(ctx, order.id, "ship")).rejects.toMatchObject({ code: "SUPPLIER_OPEN" });
    await runOrderAction(ctx, order.id, "markPaid");
    so = await only(ctx, order.id);
    expect(so.status).toBe("APPROVAL");
    expect(so.reasons).toEqual(["STOCK_UNKNOWN", "NEW_SUPPLIER", "MANUAL_RULE"]);
    expect((await openNotifications(ctx)).some((n) => n.kind === "supplierApproval" && n.entityId === so.id)).toBe(true);
    expect(await supplierOrderCounts(ctx)).toEqual({ attention: 1, open: 1 });

    await runSupplierAction(ctx, so.id, "approve");
    so = await only(ctx, order.id);
    expect(so.status).toBe("READY");
    // By hand: someone orders at the supplier and notes the supplier's number.
    expect((await openNotifications(ctx)).some((n) => n.kind === "supplierReady")).toBe(true);
    await expect(runSupplierAction(ctx, so.id, "send")).rejects.toMatchObject({ code: "STEP" });
    await runSupplierAction(ctx, so.id, "markSubmitted", { externalRef: "TA-2026-77" });
    await runSupplierAction(ctx, so.id, "confirm");
    await expect(runOrderAction(ctx, order.id, "cancel")).rejects.toMatchObject({ code: "AT_SUPPLIER" });
    await runSupplierAction(ctx, so.id, "ship", { carrier: "DHL", trackingNumber: "00340434" });

    flow = await getOrderFlow(ctx, order.id);
    expect(flow.order).toMatchObject({ fulfillmentStatus: "SHIPPED", status: "IN_PROGRESS", carrier: "DHL", trackingNumber: "00340434" });
    await runSupplierAction(ctx, so.id, "deliver");
    flow = await getOrderFlow(ctx, order.id);
    expect(flow.order).toMatchObject({ fulfillmentStatus: "DELIVERED", status: "COMPLETED" });
    expect(flow.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["supplier.created", "supplier.approve", "supplier.markSubmitted", "supplier.confirm", "supplier.ship", "shipBySupplier", "supplier.deliver", "deliverBySupplier"]),
    );
    // The company's own stock was never touched.
    expect((await getProductDetail(ctx, bag.id)).movements).toEqual([]);
    expect((await listSupplierOrders(ctx, "all")).map((s) => s.externalRef)).toEqual(["TA-2026-77"]);
    expect(supplier.id).toBe(so.supplierId);
  });

  it("refuses goods no supplier ships directly, and cancels what is not with the supplier yet", async () => {
    const { ctx, client, bag, supplier } = await dropshipper("Storno GmbH");
    const lone = await saveProduct(ctx, { kind: "PRODUCT", name: "Gürtel", priceCents: 2000, vatRate: 19, fulfillment: "DROPSHIP" });
    const nobody = await sold(ctx, client.id, lone.id);
    await expect(runOrderAction(ctx, nobody.id, "confirm")).rejects.toMatchObject({ code: "NO_SUPPLIER", lines: [{ description: "Tasche" }] });

    const order = await sold(ctx, client.id, bag.id);
    await runOrderAction(ctx, order.id, "confirm");
    await runOrderAction(ctx, order.id, "cancel");
    expect((await only(ctx, order.id)).status).toBe("CANCELLED");
    expect((await getOrderFlow(ctx, order.id)).order.fulfillmentStatus).toBe("CANCELLED");

    // A supplier that stops shipping directly takes its goods out of direct shipping.
    await saveDropshipSettings(ctx, supplier.id, { dropship: false, submitMethod: "MANUAL", rules: rules() });
    const later = await sold(ctx, client.id, bag.id);
    await expect(runOrderAction(ctx, later.id, "confirm")).rejects.toMatchObject({ code: "NO_SUPPLIER" });
  });

  it("goes out on its own within the rules, once, and tries again after a passing failure with the same key", async () => {
    const { ctx, client, bag, supplier } = await dropshipper("Auto GmbH", {
      submitMethod: "API",
      apiUrl: "https://api.taschen.example/orders",
      apiKey: "sup_key_123456789",
      rules: rules({ autoBelowCents: 10_000, approveNewSupplier: false, approveUnknownStock: false, requirePaid: false }),
    });
    const calls = fakeSupplier((n) => (n === 1 ? json(503, { error: "busy" }) : json(201, { reference: "SUP-1", status: "accepted" })));
    const order = await sold(ctx, client.id, bag.id);
    await runOrderAction(ctx, order.id, "confirm");
    let so = await only(ctx, order.id);
    expect(so).toMatchObject({ status: "SENDING", attempts: 1, lastError: "UNAVAILABLE (503)" });

    // Not due yet: nothing happens; due: the same order again.
    expect(await runSupplierOrders(new Date())).toBe(0);
    expect(await runSupplierOrders(new Date(Date.now() + 2 * 60_000))).toBe(1);
    so = await only(ctx, order.id);
    expect(so).toMatchObject({ status: "SUBMITTED", externalRef: "SUP-1", attempts: 2, lastError: null });
    expect(calls).toHaveLength(2);
    expect(calls[0].headers["idempotency-key"]).toBe(calls[1].headers["idempotency-key"]);
    expect(calls[1].headers.authorization).toBe("Bearer sup_key_123456789");
    const secret = await signingSecret(ctx, supplier.id);
    expect(verifySignature(secret, calls[1].headers["x-nexora-timestamp"], calls[1].body, calls[1].headers["x-nexora-signature"])).toBe(true);
    const sent = JSON.parse(calls[1].body);
    expect(sent).toMatchObject({ type: "order.create", lines: [{ sku: "TA-9", quantity: 1, unitCostCents: 2000 }], shipTo: { name: "Eva Muster", city: "Hamburg", country: "DE" } });
    expect(JSON.stringify(sent)).not.toContain("@");
    expect((await getDropshipSettings(ctx, supplier.id)).state).toBe("CONNECTED");
    // Sending again does not send twice.
    expect(await submitSupplierOrder(ctx.organization.id, so.id)).toBeNull();
    expect(calls).toHaveLength(2);

    // Refused credentials are not tried again.
    const refused = fakeSupplier(() => json(401, { error: "bad key" }));
    const second = await sold(ctx, client.id, bag.id);
    await runOrderAction(ctx, second.id, "confirm");
    expect(await only(ctx, second.id)).toMatchObject({ status: "FAILED", lastError: "CREDENTIALS (401)" });
    expect(await runSupplierOrders(new Date(Date.now() + 24 * 3600_000))).toBe(0);
    expect(refused).toHaveLength(1);
    expect((await getDropshipSettings(ctx, supplier.id)).state).toBe("ERROR");
    expect((await openNotifications(ctx)).some((n) => n.kind === "supplierFailed")).toBe(true);
  });

  it("goes by e-mail in the supplier's language, and not at all without a mail server", async () => {
    const { ctx, client, bag } = await dropshipper("Mail GmbH", { submitMethod: "EMAIL", orderEmail: "bestellung@taschen.example", rules: rules({ autoBelowCents: 10_000, approveNewSupplier: false, approveUnknownStock: false, requirePaid: false }) });
    const mails: Mail[] = [];
    setMailSender(async (m) => {
      mails.push(m);
    });
    const order = await sold(ctx, client.id, bag.id, 3);
    await runOrderAction(ctx, order.id, "confirm");
    expect((await only(ctx, order.id)).status).toBe("SUBMITTED");
    const toSupplier = mails.filter((m) => m.to === "bestellung@taschen.example");
    expect(toSupplier).toHaveLength(1);
    expect(toSupplier[0].text).toContain("3 × TA-9 – Tasche");
    expect(toSupplier[0].text).toContain("20095 Hamburg");
    expect(toSupplier[0].text).toContain("Lieferadresse");

    setMailSender(null);
    const next = await sold(ctx, client.id, bag.id);
    await runOrderAction(ctx, next.id, "confirm");
    expect(await only(ctx, next.id)).toMatchObject({ status: "FAILED", lastError: "NO_MAIL" });
  });
});

describe("the supplier's answers", () => {
  it("are read only when signed, change each order once, and bring stock and prices", async () => {
    const { ctx, client, bag, supplier, offer } = await dropshipper("Antwort GmbH", {
      submitMethod: "API",
      apiUrl: "https://api.taschen.example/orders",
      rules: rules({ autoBelowCents: 10_000, approveNewSupplier: false, approveUnknownStock: false, requirePaid: false }),
    });
    fakeSupplier(() => json(200, {}));
    const order = await sold(ctx, client.id, bag.id);
    await runOrderAction(ctx, order.id, "confirm");
    const so = await only(ctx, order.id);
    const [row] = await withTenant(ctx.organization.id, (tx) => tx.select().from(supplierOrders).where(eq(supplierOrders.id, so.id)));

    expect(await handleSupplierEvent(supplier.id, JSON.stringify({ type: "order.confirmed", reference: row.idempotencyKey }), String(Math.floor(Date.now() / 1000)), "forged")).toEqual({ status: 401, result: "invalid signature" });
    expect(await signed(ctx, supplier.id, { type: "order.confirmed", reference: row.idempotencyKey, externalRef: "SUP-55" })).toEqual({ status: 200, result: "confirmed" });
    expect(await signed(ctx, supplier.id, { type: "order.confirmed", reference: row.idempotencyKey })).toEqual({ status: 200, result: "duplicate" });
    expect(await signed(ctx, supplier.id, { type: "order.delivered", reference: "SUP-55" })).toMatchObject({ status: 409 });
    expect(await signed(ctx, supplier.id, { type: "order.shipped", reference: "SUP-55", carrier: "DPD", trackingNumber: "0150" })).toEqual({ status: 200, result: "shipped" });
    expect((await getOrderFlow(ctx, order.id)).order).toMatchObject({ fulfillmentStatus: "SHIPPED", carrier: "DPD", trackingNumber: "0150" });
    expect(await signed(ctx, supplier.id, { type: "ping" })).toEqual({ status: 200, result: "pong" });
    expect(await signed(ctx, supplier.id, { type: "order.shipped" })).toEqual({ status: 400, result: "reference missing" });

    // Stock: the supplier's, apart from the company's own; open supplier orders take theirs.
    expect(await signed(ctx, supplier.id, { type: "stock.updated", items: [{ sku: "TA-9", stock: 4 }, { sku: "unknown", stock: 9 }] })).toEqual({ status: 200, result: "stock 1" });
    const waiting = await sold(ctx, client.id, bag.id, 1, false);
    await saveDropshipSettings(ctx, supplier.id, { dropship: true, submitMethod: "API", apiUrl: "https://api.taschen.example/orders", rules: rules({ autoBelowCents: 10_000, requirePaid: true }) });
    await runOrderAction(ctx, waiting.id, "confirm");
    expect(await dropshipOverview(ctx, bag.id)).toMatchObject([{ offerId: offer.id, reported: 4, reserved: 1, available: 3, openOrders: 1 }]);
    expect((await withTenant(ctx.organization.id, async (tx) => (await dropshipAvailable(tx, [bag.id]))(bag.id, null)))).toBe(3);

    // A new price: kept, marked, told — and nothing is bought at it without a yes.
    expect(await signed(ctx, supplier.id, { type: "price.updated", items: [{ sku: "TA-9", priceCents: 2600 }] })).toEqual({ status: 200, result: "prices 1" });
    const [changed] = await withTenant(ctx.organization.id, (tx) => tx.select().from(productSuppliers).where(eq(productSuppliers.id, offer.id)));
    expect(changed).toMatchObject({ purchasePriceCents: 2600, previousPriceCents: 2000 });
    expect(changed.priceChangedAt).not.toBeNull();
    expect((await openNotifications(ctx)).find((n) => n.kind === "supplierPrice")?.vars).toMatchObject({ product: "Tasche", supplier: "Taschen AG", margin: "42 %" });
    await runOrderAction(ctx, waiting.id, "markPaid");
    const asked = await only(ctx, waiting.id);
    expect(asked.status).toBe("APPROVAL");
    expect(asked.reasons).toContain("PRICE");
    expect(asked.items[0].unitCostCents).toBe(2600);
    await acknowledgePrice(ctx, offer.id);
    const [ok] = await withTenant(ctx.organization.id, (tx) => tx.select().from(productSuppliers).where(eq(productSuppliers.id, offer.id)));
    expect(ok.priceChangedAt).toBeNull();
  });

  it("asks again when a price moves after the yes", async () => {
    const { ctx, client, bag, offer, supplier } = await dropshipper("Preis GmbH");
    const order = await sold(ctx, client.id, bag.id);
    await runOrderAction(ctx, order.id, "confirm");
    await runOrderAction(ctx, order.id, "markPaid");
    const so = await only(ctx, order.id);
    await runSupplierAction(ctx, so.id, "approve");
    await saveOffer(ctx, bag.id, offer.id, { supplierId: supplier.id, supplierSku: "TA-9", purchasePriceCents: 2900, shippingCostCents: 300, preferred: true });
    const company = await companyOf(ctx.organization.id);
    expect(await withTenant(ctx.organization.id, (tx) => evaluate(tx, company, so.id))).toBe("APPROVAL");
    expect(await only(ctx, order.id)).toMatchObject({ status: "APPROVAL", reasons: expect.arrayContaining(["PRICE"]), costCents: 3200 });
  });
});

describe("the store and direct shipping", () => {
  it("sells what the supplier reports, sends the order to the supplier and keeps companies apart", async () => {
    const { ctx, bag, supplier, offer } = await dropshipper("Laden Direkt GmbH");
    await getDb()
      .update(organizations)
      .set({ street: "Hauptstr. 1", postalCode: "10115", city: "Berlin", email: "shop@example.org", iban: "DE89370400440532013000" })
      .where(eq(organizations.id, ctx.organization.id));
    await saveOffer(ctx, bag.id, offer.id, { supplierId: supplier.id, supplierSku: "TA-9", purchasePriceCents: 2000, shippingCostCents: 300, preferred: true, supplierStock: 2 });
    const created = await createStore(ctx, { name: "Laden Direkt" });
    await saveShippingOptions(ctx, created.id, [{ name: "DHL", priceCents: 0, freeFromCents: null }]);
    await savePages(ctx, created.id, { imprint: "Firma", privacy: "Daten", terms: "AGB", withdrawal: "Widerruf" });
    await savePayments(ctx, created.id, { bank: true, stripe: false }, async () => true);
    await setStoreStatus(ctx, created.id, "PUBLISHED");
    const store = (await findStore((await getStore(ctx, created.id)).slug))!;

    expect((await priceCart(store, [{ productId: bag.id, quantity: 3 }])).lines[0]).toMatchObject({ available: 2, problem: "SHORT" });
    const placed = await placeOrder(store, {
      items: [{ productId: bag.id, quantity: 2 }],
      email: "eva@example.org",
      shipping: { firstName: "Eva", lastName: "Muster", street: "Weg 1", postalCode: "20095", city: "Hamburg", country: "DE" },
      shippingId: store.shipping[0].id,
      payment: "bank",
      acceptTerms: true,
    });
    const flow = await getOrderFlow(ctx, placed.orderId);
    expect(flow.order.fulfillmentStatus).toBe("AT_SUPPLIER");
    expect(await only(ctx, placed.orderId)).toMatchObject({ status: "WAITING", items: [{ quantity: 2 }] });
    // What the open supplier order takes is gone from the shelf the store shows.
    expect((await priceCart(store, [{ productId: bag.id, quantity: 1 }])).lines[0]).toMatchObject({ available: 0, problem: "SHORT" });

    const other = await newCompany("Fremd GmbH");
    expect(await listSupplierOrders(other, "all")).toEqual([]);
    const so = await only(ctx, placed.orderId);
    await expect(runSupplierAction(other, so.id, "cancel")).rejects.toBeInstanceOf(NotFoundError);
    expect(await handleSupplierEvent(supplier.id, "{}", null, null)).toEqual({ status: 401, result: "invalid signature" });
  });
});
