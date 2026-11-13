import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { orders, organizations } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createClient } from "@/server/clients";
import { contextFor } from "@/server/context";
import { createOrder } from "@/server/orders";
import { findStore } from "@/server/storefront";
import { createStore, deleteStore, listStores, savePages, saveSections, setStoreStatus } from "@/server/stores";
import { newCompany, newMember } from "./helpers";

async function company(name: string) {
  const ctx = await newCompany(name);
  await getDb().update(organizations).set({ street: "Hafenweg 2", postalCode: "20457", city: "Hamburg", email: "hallo@example.org" }).where(eq(organizations.id, ctx.organization.id));
  return (await contextFor(ctx.user))!;
}

describe("deleting a site", () => {
  it("takes a draft at once, a site online only with its name typed again, and only from those who manage", async () => {
    const ctx = await company("Weg GmbH");
    const draft = await createStore(ctx, { name: "Entwurf", kind: "company" });
    const manager = await newMember(ctx, "MANAGER");
    await expect(deleteStore(manager, draft.id)).rejects.toMatchObject({ permission: "settings.manage" });
    await deleteStore(ctx, draft.id);
    expect(await listStores(ctx, "sites")).toEqual([]);

    const live = await createStore(ctx, { name: "Live Seite", kind: "company" });
    await savePages(ctx, live.id, { imprint: "Weg GmbH", privacy: "Daten" });
    await saveSections(ctx, live.id, "home", [{ id: "h", type: "hero", title: "Live", text: "Seit 1990 in Hamburg" }]);
    await setStoreStatus(ctx, live.id, "PUBLISHED");
    await expect(deleteStore(ctx, live.id)).rejects.toMatchObject({ code: "PUBLISHED" });
    await expect(deleteStore(ctx, live.id, "Live")).rejects.toMatchObject({ code: "PUBLISHED" });
    await deleteStore(ctx, live.id, " Live Seite ");
    expect(await findStore(live.slug)).toBeNull();
  });

  it("keeps the orders of a deleted shop", async () => {
    const ctx = await company("Laden GmbH");
    const shop = await createStore(ctx, { name: "Laden" });
    const client = await createClient(ctx, { type: "COMPANY", companyName: "Käufer KG" });
    const order = await createOrder(ctx, { clientId: client.id, items: [{ description: "Lampe", quantity: 1, unit: "Stk", unitPriceCents: 1000, discountPercent: 0, vatRate: 19 }] });
    await withTenant(ctx.organization.id, (tx) => tx.update(orders).set({ storeId: shop.id }).where(eq(orders.id, order.id)));
    await deleteStore(ctx, shop.id);
    const [kept] = await withTenant(ctx.organization.id, (tx) => tx.select().from(orders).where(eq(orders.id, order.id)));
    expect(kept).toMatchObject({ id: order.id, storeId: null });
  });
});
