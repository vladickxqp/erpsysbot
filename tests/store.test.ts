import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { auditLog, organizations, stores } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { grossCents, shippingCents, slugify, validSlug } from "@/lib/store";
import { addProductImage, getProductDetail, saveCategory, saveVariantOptions } from "@/server/catalog";
import type { Context } from "@/server/context";
import { storeDocument } from "@/server/documents";
import { adjustStock } from "@/server/inventory";
import { setMailSender, type Mail } from "@/server/mail";
import { openNotifications } from "@/server/notifications";
import { getOrder, listOrders } from "@/server/orders";
import { getOrderFlow } from "@/server/order-flow";
import { saveProduct } from "@/server/products";
import { hint, seal, unseal } from "@/server/secret-box";
import { checkout, handleShopStripeWebhook, type CreateSession } from "@/server/shop-payments";
import {
  checklist,
  createStore,
  getStore,
  saveBasics,
  savePages,
  savePayments,
  saveShippingOptions,
  setStoreStatus,
  storeSecrets,
} from "@/server/stores";
import { findStore, orderForBuyer, placeOrder, priceCart, storeImage, storeProducts, type CheckoutInput, type PublicStore } from "@/server/storefront";
import { newCompany, newMember } from "./helpers";

const SECRET = "sk_test_51NexoraTestKey0000000000";
const HOOK = "whsec_testsecret0000000000000000";
const yes = async () => true;

afterEach(() => {
  vi.unstubAllEnvs();
  setMailSender(null);
});

/** A company ready to sell: address, IBAN, a lamp with five in stock, a store with shipping and legal pages. */
async function readyShop(name: string) {
  const ctx = await newCompany(name);
  await getDb()
    .update(organizations)
    .set({ street: "Hauptstr. 1", postalCode: "10115", city: "Berlin", email: "shop@example.org", iban: "DE89370400440532013000", bic: "COBADEFFXXX" })
    .where(eq(organizations.id, ctx.organization.id));
  const lamp = await saveProduct(ctx, { kind: "PRODUCT", name: "Lampe", sku: "L1", priceCents: 1000, vatRate: 19, trackStock: true });
  await adjustStock(ctx, lamp.id, { counted: 5 });
  const store = await createStore(ctx, { name });
  await saveShippingOptions(ctx, store.id, [{ name: "DHL", priceCents: 490, freeFromCents: 5000 }]);
  await savePages(ctx, store.id, { imprint: "Firma", privacy: "Daten", terms: "AGB", withdrawal: "Widerruf" });
  await savePayments(ctx, store.id, { bank: true, stripe: false }, yes);
  return { ctx, lamp, store: await getStore(ctx, store.id) };
}

async function published(ctx: Context, id: string): Promise<PublicStore> {
  await setStoreStatus(ctx, id, "PUBLISHED");
  const { slug } = await getStore(ctx, id);
  return (await findStore(slug))!;
}

const buyer = (items: CheckoutInput["items"], extra: Partial<CheckoutInput> = {}): CheckoutInput => ({
  items,
  email: "Eva@Example.org",
  shipping: { firstName: "Eva", lastName: "Muster", street: "Weg 1", postalCode: "20095", city: "Hamburg", country: "DE" },
  shippingId: "",
  payment: "bank",
  acceptTerms: true,
  ...extra,
});

describe("store rules", () => {
  it("knows good addresses, suggests one, and works out prices", () => {
    expect([validSlug("lampen-welt"), validSlug("ab"), validSlug("-lampe"), validSlug("lampe--welt"), validSlug("app"), validSlug("Lampe")]).toEqual([true, false, false, false, false, false]);
    expect(slugify("Müller & Söhne GmbH")).toBe("mueller-soehne-gmbh");
    expect(slugify("Ö")).toBe("oe-shop");
    expect([grossCents(1000, 19, false), grossCents(1000, 19, true), grossCents(999, 7, false)]).toEqual([1190, 1000, 1069]);
    expect([shippingCents({ priceCents: 490, freeFromCents: 5000 }, 4999), shippingCents({ priceCents: 490, freeFromCents: 5000 }, 5000), shippingCents({ priceCents: 490, freeFromCents: null }, 99999)]).toEqual([490, 0, 490]);
  });

  it("keeps secrets sealed and only readable with the server's key", () => {
    const sealed = seal(SECRET);
    expect(sealed).not.toContain(SECRET);
    expect(unseal(sealed)).toBe(SECRET);
    expect(unseal(sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA"))).toBeNull();
    expect(hint(SECRET)).toBe("sk_test_…0000");
    vi.stubEnv("APP_SECRET_KEY", "another key");
    expect(unseal(sealed)).toBeNull();
    expect(unseal(seal("x"))).toBe("x");
  });
});

describe("managing a store", () => {
  it("gives every store its own address and refuses taken or bad ones", async () => {
    const a = await newCompany("Lampen Welt");
    const b = await newCompany("Lampen Welt");
    const first = await createStore(a, { name: "Lampen Welt" });
    const second = await createStore(b, { name: "Lampen Welt" });
    expect([first.slug, second.slug]).toEqual(["lampen-welt", "lampen-welt-2"]);
    expect(first.status).toBe("DRAFT");
    expect(first.blocks.map((x) => x.type)).toEqual(["hero", "categories", "products", "contact"]);
    const basics = { name: "Lampen", slug: "lampen-welt", locale: "de", categoryIds: [], shipCountries: ["de", "at"] };
    await expect(saveBasics(b, second.id, basics)).rejects.toMatchObject({ code: "SLUG_TAKEN" });
    await expect(saveBasics(b, second.id, { ...basics, slug: "x" })).rejects.toMatchObject({ code: "SLUG_INVALID" });
    await saveBasics(b, second.id, { ...basics, slug: "licht-b" });
    expect(await getStore(b, second.id)).toMatchObject({ slug: "licht-b", shipCountries: ["DE", "AT"] });
    await expect(getStore(b, first.id)).rejects.toThrow();
  });

  it("goes online only when everything is there, and only by those allowed to", async () => {
    const ctx = await newCompany("Check GmbH");
    const store = await createStore(ctx, { name: "Check" });
    const before = await checklist(ctx, store.id);
    expect(before.ready).toBe(false);
    expect(before.passed).toMatchObject({ name: true, products: false, payment: false, shipping: false, address: false, legal: false });
    await expect(setStoreStatus(ctx, store.id, "PUBLISHED")).rejects.toMatchObject({ code: "CHECKS", failed: ["products", "payment", "shipping", "address", "legal"] });

    const { ctx: shop, store: ready } = await readyShop("Bereit GmbH");
    expect((await checklist(shop, ready.id)).ready).toBe(true);
    const manager = await newMember(shop, "MANAGER");
    await savePages(manager, ready.id, { ...ready.pages, about: "Wir" });
    await expect(setStoreStatus(manager, ready.id, "PUBLISHED")).rejects.toMatchObject({ permission: "settings.manage" });
    await expect(savePayments(manager, ready.id, { bank: true, stripe: false }, yes)).rejects.toMatchObject({ permission: "settings.manage" });
    const employee = await newMember(shop, "EMPLOYEE");
    await expect(createStore(employee, { name: "Nope" })).rejects.toMatchObject({ permission: "products.manage" });
    await setStoreStatus(shop, ready.id, "PUBLISHED");
    expect((await getStore(shop, ready.id)).status).toBe("PUBLISHED");
  });

  it("keeps the Stripe keys encrypted, offers card payment only with both, and never logs them", async () => {
    const { ctx, store } = await readyShop("Karten GmbH");
    await expect(savePayments(ctx, store.id, { bank: true, stripe: true, secretKey: "pk_test_123" }, yes)).rejects.toMatchObject({ code: "STRIPE_KEY" });
    await expect(savePayments(ctx, store.id, { bank: true, stripe: true, secretKey: SECRET }, async () => false)).rejects.toMatchObject({ code: "STRIPE_KEY" });
    await savePayments(ctx, store.id, { bank: true, stripe: true, secretKey: SECRET }, yes);
    expect((await getStore(ctx, store.id)).payments).toEqual({ bank: true, stripe: false });
    await expect(savePayments(ctx, store.id, { bank: true, stripe: true, webhookSecret: "nope" }, yes)).rejects.toMatchObject({ code: "STRIPE_WEBHOOK" });
    await savePayments(ctx, store.id, { bank: true, stripe: true, webhookSecret: HOOK }, yes);
    const view = await getStore(ctx, store.id);
    expect(view).toMatchObject({ payments: { bank: true, stripe: true }, stripe: { key: true, webhook: true, hint: "sk_test_…0000" } });
    expect(JSON.stringify(view)).not.toContain(SECRET);

    const [row] = await getDb().select().from(stores).where(eq(stores.id, store.id));
    expect(row.stripeSecretKey).not.toContain(SECRET);
    expect(storeSecrets(row)).toEqual({ secretKey: SECRET, webhookSecret: HOOK });
    const logged = await withTenant(ctx.organization.id, (tx) => tx.select().from(auditLog).where(eq(auditLog.action, "store.payments")));
    expect(JSON.stringify(logged)).not.toContain("sk_test");

    await savePayments(ctx, store.id, { bank: true, stripe: true, removeStripe: true }, yes);
    expect((await getStore(ctx, store.id)).stripe).toEqual({ key: false, webhook: false, hint: null });
  });
});

describe("the public store", () => {
  it("is hidden until published, except to its own company as a preview", async () => {
    const { ctx, store } = await readyShop("Vorschau GmbH");
    expect(await findStore(store.slug)).toBeNull();
    const other = await newCompany("Fremd GmbH");
    expect(await findStore(store.slug, other)).toBeNull();
    const preview = await findStore(store.slug, ctx);
    expect(preview).toMatchObject({ preview: true, methods: ["bank"], shipCountries: ["DE"] });
    await expect(placeOrder(preview!, buyer([]))).rejects.toMatchObject({ code: "CLOSED" });
    expect((await published(ctx, store.id)).preview).toBe(false);
  });

  it("shows active products with a price, gross, in its categories, with what is left", async () => {
    const { ctx, lamp, store } = await readyShop("Sortiment GmbH");
    const lights = await saveCategory(ctx, null, { name: "Licht" });
    const desk = await saveCategory(ctx, null, { name: "Tisch", parentId: lights.id });
    const garden = await saveCategory(ctx, null, { name: "Garten" });
    await saveProduct(ctx, { kind: "PRODUCT", name: "Schreibtischlampe", priceCents: 2000, vatRate: 19, categoryId: desk.id }, lamp.id);
    await saveProduct(ctx, { kind: "PRODUCT", name: "Schlauch", priceCents: 500, vatRate: 19, categoryId: garden.id });
    await saveProduct(ctx, { kind: "PRODUCT", name: "Alt", priceCents: 500, vatRate: 19, active: false });
    await saveProduct(ctx, { kind: "SERVICE", name: "Gratis", priceCents: 0, vatRate: 19 });
    const shirt = await saveProduct(ctx, { kind: "PRODUCT", name: "Shirt", sku: "TS", priceCents: 1000, vatRate: 19, trackStock: true, categoryId: lights.id });
    await saveVariantOptions(ctx, shirt.id, [{ name: "Größe", values: ["S", "M"] }]);

    const shop = await published(ctx, store.id);
    expect((await storeProducts(shop)).map((p) => p.name).sort()).toEqual(["Schlauch", "Schreibtischlampe", "Shirt"]);
    await saveBasics(ctx, store.id, { name: store.name, slug: store.slug, locale: "de", categoryIds: [lights.id] });
    const lit = (await findStore(store.slug))!;
    const list = await storeProducts(lit);
    expect(list.map((p) => [p.name, p.priceCents, p.available, p.fromPrice])).toEqual([
      ["Shirt", 1190, false, false],
      ["Schreibtischlampe", 2380, true, false],
    ]);
    expect((await storeProducts(lit, { categoryId: desk.id })).map((p) => p.name)).toEqual(["Schreibtischlampe"]);
    expect((await storeProducts(lit, { q: "tisch" })).map((p) => p.name)).toEqual(["Schreibtischlampe"]);
  });

  it("prices the cart from the records, with shipping free from its limit, and names what cannot be had", async () => {
    const { ctx, lamp, store } = await readyShop("Korb GmbH");
    const shop = await published(ctx, store.id);
    const small = await priceCart(shop, [{ productId: lamp.id, quantity: 2 }]);
    expect(small).toMatchObject({ goodsCents: 2380, shipping: { cents: 490 }, grossCents: 2870, ok: true });
    expect(small.lines[0]).toMatchObject({ name: "Lampe", unitPriceCents: 1190, lineCents: 2380, available: 5, problem: null });
    expect(small.orderLines.at(-1)).toMatchObject({ description: "Versand: DHL", unitPriceCents: 412, vatRate: 19 });

    const big = await priceCart(shop, [{ productId: lamp.id, quantity: 3 }, { productId: lamp.id, quantity: 2 }]);
    expect(big).toMatchObject({ goodsCents: 5950, shipping: { cents: 0 }, grossCents: 5950, ok: true });
    expect(big.lines).toHaveLength(1);

    const short = await priceCart(shop, [{ productId: lamp.id, quantity: 6 }]);
    expect(short.lines[0].problem).toBe("SHORT");
    const stranger = await newCompany("Fremd GmbH");
    const theirs = await saveProduct(stranger, { kind: "PRODUCT", name: "Fremd", priceCents: 100, vatRate: 19 });
    const gone = await priceCart(shop, [{ productId: theirs.id, quantity: 1 }]);
    expect([gone.lines[0].problem, gone.ok]).toEqual(["GONE", false]);
  });
});

describe("ordering", () => {
  it("makes a client and a reserved order, reuses the client next time, and lets the buyer follow it", async () => {
    const { ctx, lamp, store } = await readyShop("Bestell GmbH");
    const shop = await published(ctx, store.id);
    const mails: Mail[] = [];
    setMailSender(async (m) => {
      mails.push(m);
    });
    const first = await placeOrder(shop, buyer([{ productId: lamp.id, quantity: 2 }], { shippingId: shop.shipping[0].id, note: "Bitte klingeln" }));
    const { order, items } = await getOrder(ctx, first.orderId);
    expect(order).toMatchObject({ channel: "SHOP", status: "CONFIRMED", fulfillmentStatus: "RESERVED", paymentStatus: "UNPAID", paymentMethod: "bank", grossCents: 2870, storeId: store.id, shipCity: "Hamburg", notes: "Bitte klingeln" });
    expect(order.externalRef).toBe(`${store.slug}-${order.number}`);
    expect(items.map((i) => i.description)).toEqual(["Lampe", "Versand: DHL"]);
    // Written in one transaction: same time, so compared without order.
    expect((await getOrderFlow(ctx, first.orderId)).events.map((e) => e.kind).sort()).toEqual(["checkout", "confirm"]);
    expect((await priceCart(shop, [{ productId: lamp.id, quantity: 1 }])).lines[0].available).toBe(3);

    const second = await placeOrder(shop, buyer([{ productId: lamp.id, quantity: 1 }], { shippingId: shop.shipping[0].id, email: "eva@example.org" }));
    expect((await getOrder(ctx, second.orderId)).order.clientId).toBe(order.clientId);

    const seen = await orderForBuyer(shop, first.token);
    expect(seen).toMatchObject({ number: order.number, fulfillment: "RESERVED", payment: "UNPAID", method: "bank", grossCents: 2870 });
    expect(await orderForBuyer(shop, "x".repeat(32))).toBeNull();
    expect(mails[0]).toMatchObject({ to: "eva@example.org", subject: `Ihre Bestellung ${order.number} bei ${shop.name}` });
    expect(mails[0].text).toContain("DE89370400440532013000");
    expect(mails[0].text).toContain(`/shop/${store.slug}/order/${first.token}`);
    expect((await openNotifications(ctx)).map((n) => n.kind)).toContain("shopOrder");
  });

  it("refuses what is not there, where it does not ship and how it cannot pay — and leaves no order behind", async () => {
    const { ctx, lamp, store } = await readyShop("Nein GmbH");
    const shop = await published(ctx, store.id);
    const shipping = { shippingId: shop.shipping[0].id };
    await expect(placeOrder(shop, buyer([{ productId: lamp.id, quantity: 6 }], shipping))).rejects.toMatchObject({ code: "SHORT", lines: [{ name: "Lampe", available: 5 }] });
    await expect(placeOrder(shop, buyer([{ productId: lamp.id, quantity: 1 }], { ...shipping, shipping: { ...buyer([]).shipping, country: "FR" } }))).rejects.toMatchObject({ code: "COUNTRY" });
    await expect(placeOrder(shop, buyer([{ productId: lamp.id, quantity: 1 }], { ...shipping, payment: "stripe" }))).rejects.toMatchObject({ code: "PAYMENT" });
    await expect(placeOrder(shop, buyer([{ productId: lamp.id, quantity: 1 }], { shippingId: "nope" }))).rejects.toMatchObject({ code: "SHIPPING" });
    await expect(placeOrder(shop, { ...buyer([{ productId: lamp.id, quantity: 1 }], shipping), acceptTerms: false as true })).rejects.toThrow();
    expect((await listOrders(ctx)).total).toBe(0);
  });
});

describe("card payment", () => {
  async function cardShop(name: string) {
    vi.stubEnv("APP_URL", "https://shop.example");
    const { ctx, lamp, store } = await readyShop(name);
    await savePayments(ctx, store.id, { bank: false, stripe: true, secretKey: SECRET, webhookSecret: HOOK }, yes);
    const shop = await published(ctx, store.id);
    return { ctx, lamp, store, shop };
  }

  const signed = (event: unknown) => {
    const payload = JSON.stringify(event);
    return { payload, signature: new Stripe(SECRET).webhooks.generateTestHeaderString({ payload, secret: HOOK }) };
  };

  const session = (type: string, orderId: string, extra: Record<string, unknown> = {}, id = `evt_${Math.random().toString(36).slice(2)}`) =>
    signed({
      id,
      object: "event",
      type,
      data: { object: { id: "cs_test_1", object: "checkout.session", payment_status: "paid", amount_total: 2870, currency: "eur", metadata: { orderId }, client_reference_id: orderId, payment_intent: "pi_test_1", customer_details: { email: "eva@example.org" }, ...extra } },
    });

  it("charges exactly the order on Stripe's page, and cancels the order when the payment cannot start", async () => {
    const { ctx, lamp, shop } = await cardShop("Karte GmbH");
    const calls: { key: string; params: Stripe.Checkout.SessionCreateParams; idem: string }[] = [];
    const create: CreateSession = async (key, params, idem) => {
      calls.push({ key, params, idem });
      return { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" };
    };
    const done = await checkout(shop, buyer([{ productId: lamp.id, quantity: 2 }], { shippingId: shop.shipping[0].id, payment: "stripe" }), "1.2.3.4", create);
    expect(done.payUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    const [call] = calls;
    expect(call.key).toBe(SECRET);
    expect(call.params.line_items).toEqual([expect.objectContaining({ quantity: 1, price_data: expect.objectContaining({ currency: "eur", unit_amount: 2870 }) })]);
    expect(call.params.success_url).toBe(`https://shop.example/shop/${shop.slug}/order/${done.token}?paid=1`);
    const [order] = (await listOrders(ctx)).rows;
    expect(call.params.metadata).toEqual({ orderId: order.id, storeId: shop.id });
    expect(call.idem).toBe(`order-${order.id}`);
    expect((await getOrder(ctx, order.id)).order.paymentReference).toBe("cs_test_1");

    const broken: CreateSession = async () => {
      throw new Error("stripe down");
    };
    await expect(checkout(shop, buyer([{ productId: lamp.id, quantity: 1 }], { shippingId: shop.shipping[0].id, payment: "stripe" }), "1.2.3.4", broken)).rejects.toMatchObject({ code: "PAYMENT" });
    const cancelled = (await listOrders(ctx)).rows.find((r) => r.id !== order.id)!;
    expect((await getOrder(ctx, cancelled.id)).order).toMatchObject({ fulfillmentStatus: "CANCELLED", status: "CANCELLED" });
  });

  it("marks paid only on a signed message with the right amount, once", async () => {
    const { ctx, lamp, store, shop } = await cardShop("Webhook GmbH");
    const mails: Mail[] = [];
    setMailSender(async (m) => {
      mails.push(m);
    });
    const placed = await placeOrder(shop, buyer([{ productId: lamp.id, quantity: 2 }], { shippingId: shop.shipping[0].id, payment: "stripe" }));

    const forged = session("checkout.session.completed", placed.orderId);
    await expect(handleShopStripeWebhook(store.id, forged.payload, forged.signature.replace(/v1=[0-9a-f]+/, `v1=${"0".repeat(64)}`))).rejects.toMatchObject({ code: "SIGNATURE" });
    await expect(handleShopStripeWebhook(store.id, forged.payload.replace("2870", "1"), forged.signature)).rejects.toMatchObject({ code: "SIGNATURE" });
    await expect(handleShopStripeWebhook("00000000-0000-0000-0000-000000000000", forged.payload, forged.signature)).rejects.toMatchObject({ code: "UNKNOWN" });

    const wrong = session("checkout.session.completed", placed.orderId, { amount_total: 100 });
    expect(await handleShopStripeWebhook(store.id, wrong.payload, wrong.signature)).toBe("amount mismatch");
    expect((await getOrder(ctx, placed.orderId)).order.paymentStatus).toBe("UNPAID");
    expect((await openNotifications(ctx)).map((n) => n.kind)).toContain("shopPayment");

    const paid = session("checkout.session.completed", placed.orderId, {}, "evt_paid");
    expect(await handleShopStripeWebhook(store.id, paid.payload, paid.signature)).toBe("paid");
    expect(await handleShopStripeWebhook(store.id, paid.payload, paid.signature)).toBe("duplicate");
    const { order } = await getOrder(ctx, placed.orderId);
    expect(order).toMatchObject({ paymentStatus: "PAID", paymentReference: "pi_test_1", fulfillmentStatus: "RESERVED" });
    const kinds = (await getOrderFlow(ctx, placed.orderId)).events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "markPaid")).toHaveLength(1);
    expect(kinds).toContain("paymentMismatch");
    expect(mails.map((m) => m.subject)).toContain(`Zahlung erhalten: Bestellung ${order.number}`);

    const refunded = signed({ id: "evt_refund", object: "event", type: "charge.refunded", data: { object: { id: "ch_1", object: "charge", amount: 2870, amount_refunded: 2870, payment_intent: "pi_test_1" } } });
    expect(await handleShopStripeWebhook(store.id, refunded.payload, refunded.signature)).toBe("refunded");
    expect((await getOrder(ctx, placed.orderId)).order.paymentStatus).toBe("REFUNDED");
  });

  it("frees the goods when the payment runs out, and flags money that comes after", async () => {
    const { ctx, lamp, store, shop } = await cardShop("Ablauf GmbH");
    const placed = await placeOrder(shop, buyer([{ productId: lamp.id, quantity: 5 }], { shippingId: shop.shipping[0].id, payment: "stripe" }));
    expect((await priceCart(shop, [{ productId: lamp.id, quantity: 1 }])).lines[0].available).toBe(0);
    const expired = session("checkout.session.expired", placed.orderId, { payment_status: "unpaid" });
    expect(await handleShopStripeWebhook(store.id, expired.payload, expired.signature)).toBe("expired");
    expect((await getOrder(ctx, placed.orderId)).order).toMatchObject({ fulfillmentStatus: "CANCELLED", paymentStatus: "UNPAID" });
    expect((await priceCart(shop, [{ productId: lamp.id, quantity: 1 }])).lines[0].available).toBe(5);

    const late = session("checkout.session.completed", placed.orderId, { amount_total: 5950 });
    expect(await handleShopStripeWebhook(store.id, late.payload, late.signature)).toBe("paid after cancel");
    expect((await getOrder(ctx, placed.orderId)).order.paymentStatus).toBe("UNPAID");

    // Another store (with the same keys) cannot touch this order.
    const other = await cardShop("Andere GmbH");
    const theirs = session("checkout.session.completed", placed.orderId);
    expect(await handleShopStripeWebhook(other.store.id, theirs.payload, theirs.signature)).toBe("unknown order");
  });
});

describe("pictures", () => {
  it("serves only what the store shows", async () => {
    const { ctx, lamp, store } = await readyShop("Bild GmbH");
    const png = (name: string) => storeDocument(ctx, { name, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) });
    const [shown, secret] = [await png("lampe.png"), await png("vertrag.png")];
    await addProductImage(ctx, lamp.id, shown.id);
    const shop = await published(ctx, store.id);
    expect(await storeImage(shop, shown.id)).toMatchObject({ mime: "image/png", size: 11 });
    expect(await storeImage(shop, secret.id)).toBeNull();
    expect((await storeProducts(shop))[0].imageId).toBe(shown.id);
    expect((await getProductDetail(ctx, lamp.id)).product.name).toBe("Lampe");
  });
});
