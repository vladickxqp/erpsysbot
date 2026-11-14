import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { digitalItems, orders, organizations } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createClient } from "@/server/clients";
import type { Context } from "@/server/context";
import { addDigitalItems, deleteDigitalItem, digitalOfOrder, digitalOverview, maskOf, revealDigitalItem, saveDigitalSettings } from "@/server/digital";
import { setMailSender, type Mail } from "@/server/mail";
import { openNotifications } from "@/server/notifications";
import { runOrderAction } from "@/server/order-flow";
import { createOrder } from "@/server/orders";
import { saveProduct } from "@/server/products";
import { createStore, getStore, savePages, savePayments, saveShippingOptions, setStoreStatus } from "@/server/stores";
import { findStore, placeOrder, priceCart, storeProducts, type CheckoutInput } from "@/server/storefront";
import { newCompany, newMember } from "./helpers";

afterEach(() => setMailSender(null));

/** A company with a published shop, ready to sell. */
async function shopOf(name: string) {
  const ctx = await newCompany(name);
  await getDb()
    .update(organizations)
    .set({ street: "Hauptstr. 1", postalCode: "10115", city: "Berlin", email: "shop@example.org", iban: "DE89370400440532013000" })
    .where(eq(organizations.id, ctx.organization.id));
  const store = await createStore(ctx, { name });
  await saveShippingOptions(ctx, store.id, [{ name: "DHL", priceCents: 490, freeFromCents: null }]);
  await savePages(ctx, store.id, { imprint: "Firma", privacy: "Daten", terms: "AGB", withdrawal: "Widerruf" });
  await savePayments(ctx, store.id, { bank: true, stripe: false }, async () => true);
  return { ctx, storeId: store.id };
}

const digital = (ctx: Context, name: string) => saveProduct(ctx, { kind: "PRODUCT", name, priceCents: 1000, vatRate: 19, fulfillment: "DIGITAL", trackStock: true });
const line = (productId: string, quantity: number) => ({ productId, description: "Spielkonto", quantity, unit: "Stk", unitPriceCents: 1000, discountPercent: 0, vatRate: 19 });
const orderOf = async (ctx: Context, id: string) => (await withTenant(ctx.organization.id, (tx) => tx.select().from(orders).where(eq(orders.id, id))))[0];

const buyer = (items: CheckoutInput["items"], shippingId: string): CheckoutInput => ({
  items,
  email: "eva@example.org",
  shipping: { firstName: "Eva", lastName: "Muster", street: "Weg 1", postalCode: "20095", city: "Hamburg", country: "DE" },
  shippingId,
  payment: "bank",
  acceptTerms: true,
});

describe("digital goods in a shop", () => {
  it("sells what the pool holds, keeps it for open orders and hands it out when the order is paid", async () => {
    const { ctx, storeId } = await shopOf("Konten Shop");
    const product = await digital(ctx, "Spielkonto");
    expect(product).toMatchObject({ fulfillment: "DIGITAL", trackStock: false });
    expect(await addDigitalItems(ctx, product.id, { text: "user1:geheim-eins\nuser2:geheim-zwei\n\nuser2:geheim-zwei\n user3:geheim-drei " })).toEqual({ added: 3, delivered: 0 });
    const pool = await digitalOverview(ctx, product.id);
    expect(pool).toMatchObject({ shared: false, available: 3, sold: 0, waiting: 0 });
    expect(pool.items.map((i) => i.mask).sort()).toEqual(["use•••ei", "use•••ei", "use•••ns"]);
    // Sealed in the database, readable for the person who looks after the product.
    const stored = await withTenant(ctx.organization.id, (tx) => tx.select().from(digitalItems).where(eq(digitalItems.productId, product.id)));
    expect(stored.some((s) => s.content.includes("geheim"))).toBe(false);
    expect((await revealDigitalItem(ctx, pool.items[0].id)).startsWith("user")).toBe(true);

    await setStoreStatus(ctx, storeId, "PUBLISHED");
    const shop = (await findStore((await getStore(ctx, storeId)).slug))!;
    const shippingId = shop.shipping[0].id;
    expect((await storeProducts(shop)).map((p) => [p.name, p.available])).toEqual([["Spielkonto", true]]);
    const four = await priceCart(shop, [{ productId: product.id, quantity: 4 }], shippingId);
    expect(four.lines[0]).toMatchObject({ available: 3, problem: "SHORT" });
    // Digital goods travel nowhere: no shipping to pay.
    const two = await priceCart(shop, [{ productId: product.id, quantity: 2 }], shippingId);
    expect(two).toMatchObject({ ok: true, grossCents: 2380, shipping: { cents: 0 } });

    const mails: Mail[] = [];
    setMailSender(async (mail) => {
      mails.push(mail);
      return { messageId: "x" };
    });
    const placed = await placeOrder(shop, buyer([{ productId: product.id, quantity: 2 }], shippingId));
    expect(await orderOf(ctx, placed.orderId)).toMatchObject({ fulfillmentStatus: "RESERVED", paymentStatus: "UNPAID" });
    // Two of three are held for the order that is not paid yet; nothing is shown before payment.
    expect((await priceCart(shop, [{ productId: product.id, quantity: 2 }], shippingId)).lines[0]).toMatchObject({ available: 1, problem: "SHORT" });
    expect(await digitalOfOrder(ctx.organization.id, placed.orderId)).toEqual([]);

    await runOrderAction(ctx, placed.orderId, "markPaid");
    expect(await orderOf(ctx, placed.orderId)).toMatchObject({ fulfillmentStatus: "DELIVERED", status: "COMPLETED", paymentStatus: "PAID" });
    const given = await digitalOfOrder(ctx.organization.id, placed.orderId);
    expect(given).toMatchObject([{ description: "Spielkonto", quantity: 2, shared: false, missing: 0 }]);
    expect(given[0].entries).toHaveLength(2);
    expect(given[0].entries.every((e) => /^user\d:geheim-/.test(e))).toBe(true);
    expect(mails.map((m) => m.subject).filter((s) => s.includes("Ihre Artikel sind bereit"))).toHaveLength(1);

    expect(await digitalOverview(ctx, product.id)).toMatchObject({ available: 1, sold: 2 });
    expect((await priceCart(shop, [{ productId: product.id, quantity: 1 }], shippingId)).ok).toBe(true);
    const after = await digitalOverview(ctx, product.id);
    await expect(deleteDigitalItem(ctx, after.items.find((i) => i.status === "SOLD")!.id)).rejects.toMatchObject({ code: "SOLD" });
    await deleteDigitalItem(ctx, after.items.find((i) => i.status === "AVAILABLE")!.id);
    expect((await storeProducts(shop)).map((p) => p.available)).toEqual([false]);
  });

  it("serves a paid order that waited as soon as the pool is filled, and tells the company", async () => {
    const ctx = await newCompany("Warte GmbH");
    const product = await digital(ctx, "Lizenz");
    await addDigitalItems(ctx, product.id, { text: "LIZENZ-AAAA-1111" });
    const client = await createClient(ctx, { type: "COMPANY", companyName: "Käufer KG" });
    const order = await createOrder(ctx, { clientId: client.id, items: [line(product.id, 2)] });
    await runOrderAction(ctx, order.id, "markPaid");
    expect(await orderOf(ctx, order.id)).toMatchObject({ fulfillmentStatus: "UNFULFILLED", paymentStatus: "PAID" });
    expect(await digitalOfOrder(ctx.organization.id, order.id)).toMatchObject([{ entries: ["LIZENZ-AAAA-1111"], missing: 1 }]);
    expect((await digitalOverview(ctx, product.id)).waiting).toBe(1);
    const notes = (await openNotifications(ctx)).filter((n) => n.kind === "automation");
    expect(notes).toHaveLength(1);
    expect(String((notes[0].vars as { message?: string }).message)).toContain(`#${order.number}`);

    expect(await addDigitalItems(ctx, product.id, { text: "LIZENZ-BBBB-2222\nLIZENZ-CCCC-3333" })).toEqual({ added: 2, delivered: 1 });
    expect(await orderOf(ctx, order.id)).toMatchObject({ fulfillmentStatus: "DELIVERED", status: "COMPLETED" });
    const given = await digitalOfOrder(ctx.organization.id, order.id);
    expect(given[0].entries).toHaveLength(2);
    expect(given[0].missing).toBe(0);
    expect(await digitalOverview(ctx, product.id)).toMatchObject({ available: 1, sold: 2, waiting: 0 });
  });

  it("gives goods every buyer gets alike their note, and leaves an order with other goods open", async () => {
    const ctx = await newCompany("Datei GmbH");
    const guide = await digital(ctx, "Anleitung");
    await saveDigitalSettings(ctx, guide.id, { shared: true, note: "Download: https://example.org/anleitung.pdf" });
    const lamp = await saveProduct(ctx, { kind: "PRODUCT", name: "Lampe", priceCents: 500, vatRate: 19 });
    const client = await createClient(ctx, { type: "PERSON", firstName: "Eva", lastName: "Muster" });

    const only = await createOrder(ctx, { clientId: client.id, items: [line(guide.id, 3)] });
    await runOrderAction(ctx, only.id, "markPaid");
    expect(await orderOf(ctx, only.id)).toMatchObject({ fulfillmentStatus: "DELIVERED", status: "COMPLETED" });
    expect(await digitalOfOrder(ctx.organization.id, only.id)).toEqual([{ description: "Spielkonto", quantity: 3, note: "Download: https://example.org/anleitung.pdf", shared: true, entries: [], missing: 0 }]);

    const mixed = await createOrder(ctx, { clientId: client.id, items: [line(guide.id, 1), { ...line(lamp.id, 1), description: "Lampe" }] });
    await runOrderAction(ctx, mixed.id, "markPaid");
    expect((await orderOf(ctx, mixed.id)).fulfillmentStatus).toBe("UNFULFILLED");
    expect(await digitalOfOrder(ctx.organization.id, mixed.id)).toHaveLength(1);
  });

  it("is looked after by those who manage products, and only for digital products", async () => {
    const ctx = await newCompany("Rechte GmbH");
    const product = await digital(ctx, "Code");
    const lamp = await saveProduct(ctx, { kind: "PRODUCT", name: "Lampe", priceCents: 500, vatRate: 19 });
    const viewer = await newMember(ctx, "VIEWER");
    await expect(addDigitalItems(viewer, product.id, { text: "x" })).rejects.toMatchObject({ permission: "products.manage" });
    await expect(digitalOverview(viewer, product.id)).rejects.toMatchObject({ permission: "products.manage" });
    await expect(addDigitalItems(ctx, lamp.id, { text: "x" })).rejects.toMatchObject({ code: "NOT_DIGITAL" });
    await expect(addDigitalItems(ctx, product.id, { text: " \n " })).rejects.toMatchObject({ code: "EMPTY" });
    const other = await newCompany("Fremd GmbH");
    await expect(addDigitalItems(other, product.id, { text: "x" })).rejects.toThrow();
    expect([maskOf("ABCD-1234-EFGH"), maskOf("kurz")]).toEqual(["ABC•••GH", "•••"]);
  });
});
