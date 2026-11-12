import { describe, expect, it } from "vitest";
import { actionsFor, canDo, linesLocked } from "@/lib/order-flow";
import { getProductDetail, saveVariantOptions } from "@/server/catalog";
import { createClient } from "@/server/clients";
import type { Context } from "@/server/context";
import { adjustStock } from "@/server/inventory";
import { flowCounts, getOrderFlow, heldForProduct, lineProducts, runOrderAction, saveShipping } from "@/server/order-flow";
import { createOrder, getOrder, listOrders, setOrderStatus, updateOrder } from "@/server/orders";
import { saveProduct } from "@/server/products";
import { newCompany, newMember } from "./helpers";

async function shop(name: string) {
  const ctx = await newCompany(name);
  const client = await createClient(ctx, { lastName: "Kunde" });
  const lamp = await saveProduct(ctx, { kind: "PRODUCT", name: "Lampe", sku: "L1", priceCents: 5000, vatRate: 19, trackStock: true });
  await adjustStock(ctx, lamp.id, { counted: 5 });
  return { ctx, client, lamp };
}

const line = (productId: string, quantity: number, variantId?: string) => ({ productId, variantId, description: "Lampe", quantity, unit: "Stk", unitPriceCents: 5000, vatRate: 19 });
const order = (ctx: Context, clientId: string, items: ReturnType<typeof line>[]) => createOrder(ctx, { clientId, items });
const stock = async (ctx: Context, id: string) => Number((await getProductDetail(ctx, id)).product.stockQuantity);

describe("order flow rules", () => {
  it("allows each step only from where it can come", () => {
    expect(actionsFor({ fulfillment: "UNFULFILLED", payment: "UNPAID" })).toEqual(["confirm", "cancel", "markPaid"]);
    expect(actionsFor({ fulfillment: "RESERVED", payment: "PAID" })).toEqual(["pick", "pack", "ship", "cancel", "markUnpaid", "refund"]);
    expect(actionsFor({ fulfillment: "SHIPPED", payment: "UNPAID" })).toEqual(["deliver", "markPaid"]);
    expect(actionsFor({ fulfillment: "AT_SUPPLIER", payment: "PAID" })).toEqual(["ship", "cancel", "markUnpaid", "refund"]);
    expect(canDo("cancel", { fulfillment: "SHIPPED", payment: "UNPAID" })).toBe(false);
    expect(canDo("markPaid", { fulfillment: "CANCELLED", payment: "UNPAID" })).toBe(false);
    expect(canDo("refund", { fulfillment: "CANCELLED", payment: "PAID" })).toBe(true);
    expect([linesLocked("UNFULFILLED"), linesLocked("RESERVED"), linesLocked("DELIVERED"), linesLocked("CANCELLED")]).toEqual([false, true, true, false]);
  });
});

describe("order flow", () => {
  it("holds goods on confirming, takes them out of stock on shipping, once", async () => {
    const { ctx, client, lamp } = await shop("Lampen GmbH");
    const a = await order(ctx, client.id, [line(lamp.id, 3)]);
    const b = await order(ctx, client.id, [line(lamp.id, 3)]);
    await runOrderAction(ctx, a.id, "confirm");
    expect(await heldForProduct(ctx, lamp.id)).toEqual({ total: 3, byVariant: {} });
    expect((await getOrderFlow(ctx, b.id)).lines).toMatchObject([{ needed: 3, stock: 5, held: 3, available: 2, enough: false }]);
    await expect(runOrderAction(ctx, b.id, "confirm")).rejects.toMatchObject({ code: "SHORT", lines: [{ description: "Lampe", needed: 3, available: 2 }] });
    await runOrderAction(ctx, b.id, "confirm", { allowShort: true });

    await expect(runOrderAction(ctx, a.id, "deliver")).rejects.toMatchObject({ code: "STEP" });
    await runOrderAction(ctx, a.id, "pick");
    await runOrderAction(ctx, a.id, "ship", { carrier: "DHL", trackingNumber: "00340434" });
    expect(await stock(ctx, lamp.id)).toBe(2);
    await runOrderAction(ctx, a.id, "deliver");
    expect(await stock(ctx, lamp.id)).toBe(2);
    await expect(runOrderAction(ctx, a.id, "cancel")).rejects.toMatchObject({ code: "STEP" });

    const done = await getOrderFlow(ctx, a.id);
    expect(done.order).toMatchObject({ status: "COMPLETED", fulfillmentStatus: "DELIVERED", carrier: "DHL", trackingNumber: "00340434" });
    expect(done.order.shippedAt).not.toBeNull();
    expect(done.events.map((e) => e.kind)).toEqual(["deliver", "ship", "pick", "confirm"]);
    expect((await getOrderFlow(ctx, b.id)).events[0].data).toMatchObject({ short: [{ needed: 3, available: 2 }] });
  });

  it("frees what a cancelled order held and keeps its lines closed while goods are held", async () => {
    const { ctx, client, lamp } = await shop("Storno GmbH");
    const a = await order(ctx, client.id, [line(lamp.id, 4)]);
    const b = await order(ctx, client.id, [line(lamp.id, 2)]);
    await runOrderAction(ctx, a.id, "confirm");
    expect((await getOrderFlow(ctx, b.id)).lines[0].available).toBe(1);
    await expect(updateOrder(ctx, a.id, { clientId: client.id, items: [line(lamp.id, 1)] })).rejects.toMatchObject({ code: "LOCKED" });
    await runOrderAction(ctx, a.id, "cancel");
    expect((await getOrder(ctx, a.id)).order).toMatchObject({ status: "CANCELLED", fulfillmentStatus: "CANCELLED" });
    expect((await getOrderFlow(ctx, b.id)).lines[0].available).toBe(5);
    await updateOrder(ctx, a.id, { clientId: client.id, status: "CANCELLED", items: [line(lamp.id, 1)] });
    expect(await stock(ctx, lamp.id)).toBe(5);
  });

  it("books the variant that was sold", async () => {
    const { ctx, client } = await shop("Mode GmbH");
    const shirt = await saveProduct(ctx, { kind: "PRODUCT", name: "Shirt", sku: "TS", priceCents: 2000, vatRate: 19, trackStock: true });
    await saveVariantOptions(ctx, shirt.id, [{ name: "Größe", values: ["S", "M"] }]);
    const [small, medium] = (await getProductDetail(ctx, shirt.id)).variants;
    await adjustStock(ctx, shirt.id, { counted: 4, variantId: medium.id });

    const options = await lineProducts(ctx);
    expect(options.filter((o) => o.id === shirt.id).map((o) => [o.name, o.variantId])).toEqual([
      ["Shirt / S", small.id],
      ["Shirt / M", medium.id],
    ]);

    const o = await order(ctx, client.id, [line(shirt.id, 1, medium.id), line(shirt.id, 1, small.id)]);
    expect((await getOrderFlow(ctx, o.id)).lines.map((l) => [l.variantId, l.available, l.enough])).toEqual([
      [medium.id, 4, true],
      [small.id, 0, false],
    ]);
    await runOrderAction(ctx, o.id, "confirm", { allowShort: true });
    await runOrderAction(ctx, o.id, "ship");
    const detail = await getProductDetail(ctx, shirt.id);
    expect(detail.variants.map((v) => [v.sku, Number(v.stockQuantity)])).toEqual([
      ["TS-S", -1],
      ["TS-M", 3],
    ]);
    expect(Number(detail.product.stockQuantity)).toBe(2);
    expect((await getOrder(ctx, o.id)).items.map((i) => i.variantId)).toEqual([medium.id, small.id]);

    const other = await saveProduct(ctx, { kind: "PRODUCT", name: "Hose", priceCents: 100, vatRate: 19 });
    await expect(order(ctx, client.id, [line(other.id, 1, medium.id)])).rejects.toThrow();
  });

  it("keeps the plain status and the goods in step, and tracks payment alongside", async () => {
    const { ctx, client, lamp } = await shop("Status GmbH");
    const a = await order(ctx, client.id, [line(lamp.id, 2)]);
    await runOrderAction(ctx, a.id, "confirm");
    await runOrderAction(ctx, a.id, "markPaid");
    expect(await flowCounts(ctx)).toEqual({ toShip: 1, shipped: 0, unpaid: 0 });
    expect((await listOrders(ctx, { flow: "toShip" })).rows.map((r) => r.id)).toEqual([a.id]);
    await setOrderStatus(ctx, a.id, "COMPLETED");
    expect((await getOrder(ctx, a.id)).order).toMatchObject({ fulfillmentStatus: "DELIVERED", paymentStatus: "PAID" });
    expect(await stock(ctx, lamp.id)).toBe(3);
    await runOrderAction(ctx, a.id, "refund");
    expect((await getOrder(ctx, a.id)).order.paymentStatus).toBe("REFUNDED");
    expect((await listOrders(ctx, { flow: "toShip" })).total).toBe(0);

    const service = await createOrder(ctx, { clientId: client.id, items: [{ description: "Montage", quantity: 1, unit: "Std", unitPriceCents: 6500, vatRate: 19 }] });
    await setOrderStatus(ctx, service.id, "COMPLETED");
    expect((await getOrder(ctx, service.id)).order.fulfillmentStatus).toBe("UNFULFILLED");
  });

  it("keeps the address once the parcel is out", async () => {
    const { ctx, client, lamp } = await shop("Adress GmbH");
    const a = await order(ctx, client.id, [line(lamp.id, 1)]);
    await saveShipping(ctx, a.id, { channel: "SHOP", externalRef: "#1001", shipName: "Eva Muster", shipStreet: "Weg 1", shipPostalCode: "10115", shipCity: "Berlin", shipCountry: "de" });
    expect((await listOrders(ctx, { q: "1001" })).rows.map((r) => r.id)).toEqual([a.id]);
    await runOrderAction(ctx, a.id, "confirm");
    await runOrderAction(ctx, a.id, "ship");
    await saveShipping(ctx, a.id, { channel: "MARKETPLACE", externalRef: "X-9", shipCity: "Hamburg" });
    expect((await getOrder(ctx, a.id)).order).toMatchObject({ channel: "MARKETPLACE", externalRef: "X-9", shipCity: "Berlin", shipCountry: "DE" });
    await expect(saveShipping(ctx, a.id, { channel: "NOPE" as never })).rejects.toThrow();
  });

  it("keeps every company's orders and holdings to itself and asks for the right permission", async () => {
    const a = await shop("A GmbH");
    const b = await shop("B GmbH");
    const mine = await order(a.ctx, a.client.id, [line(a.lamp.id, 5)]);
    await runOrderAction(a.ctx, mine.id, "confirm");
    const theirs = await order(b.ctx, b.client.id, [line(b.lamp.id, 5)]);
    expect((await getOrderFlow(b.ctx, theirs.id)).lines[0]).toMatchObject({ held: 0, available: 5 });
    await expect(runOrderAction(b.ctx, mine.id, "cancel")).rejects.toThrow();
    await expect(getOrderFlow(b.ctx, mine.id)).rejects.toThrow();
    await expect(saveShipping(b.ctx, mine.id, { shipCity: "X" })).rejects.toThrow();

    const viewer = await newMember(a.ctx, "VIEWER");
    await expect(runOrderAction(viewer, mine.id, "ship")).rejects.toMatchObject({ permission: "orders.update" });
    await expect(saveShipping(viewer, mine.id, { shipCity: "X" })).rejects.toMatchObject({ permission: "orders.update" });
    expect((await getOrderFlow(viewer, mine.id)).order.fulfillmentStatus).toBe("RESERVED");
  });
});
