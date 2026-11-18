import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { geoPlaces } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createClient } from "@/server/clients";
import type { Context } from "@/server/context";
import { locatePlaces, placeKey, shipmentMap, type GeoFetch } from "@/server/geo";
import { createOrder } from "@/server/orders";
import { addShipmentEvent, recordShipment } from "@/server/shipments";
import { newCompany, newMember } from "./helpers";

/** Nominatim as the map sees it: knows two towns, remembers every question. */
function fakeNominatim(down = false) {
  const asked: { url: string; agent: string }[] = [];
  const towns: Record<string, [string, string]> = { leipzig: ["51.3397", "12.3731"], hamburg: ["53.5511", "9.9937"] };
  const fetcher: GeoFetch = async (url, init) => {
    asked.push({ url, agent: init.headers["User-Agent"] });
    if (down) return { ok: false, json: async () => ({}) };
    const q = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
    const hit = towns[q];
    return { ok: true, json: async () => (hit ? [{ lat: hit[0], lon: hit[1], display_name: q }] : []) };
  };
  return { fetcher, asked };
}

async function parcel(ctx: Context, name: string, places: string[]) {
  const client = await createClient(ctx, { type: "PERSON", firstName: "Eva", lastName: name });
  const order = await createOrder(ctx, { clientId: client.id, items: [{ description: "Lampe", quantity: 1, unit: "Stk", unitPriceCents: 1000, discountPercent: 0, vatRate: 19 }] });
  const shipment = await withTenant(ctx.organization.id, (tx) =>
    recordShipment(tx, { organizationId: ctx.organization.id, orderId: order.id, carrier: "dhl", trackingNumber: "00340434161094042557", userId: ctx.user.userId, source: "manual" }),
  );
  for (const [i, location] of places.entries()) {
    await addShipmentEvent(ctx, shipment.id, { status: "IN_TRANSIT", location, at: new Date(Date.now() - (places.length - i) * 60_000) });
  }
  return { order, shipment };
}

describe("the shipment map", () => {
  it("looks each reported place up once, by name only, and puts the parcel at its last place", async () => {
    const ctx = await newCompany("Karten GmbH");
    const { order, shipment } = await parcel(ctx, "Muster", ["Hamburg", " LEIPZIG "]);
    await parcel(ctx, "Nirgends", ["Atlantis"]);
    const before = await shipmentMap(ctx);
    expect(before.find((p) => p.id === shipment.id)).toMatchObject({ place: "LEIPZIG", lat: null, lng: null });

    const nominatim = fakeNominatim();
    expect(await locatePlaces(nominatim.fetcher, 20, 0)).toBeGreaterThanOrEqual(2);
    const asked = nominatim.asked.map((a) => decodeURIComponent(new URL(a.url).searchParams.get("q") ?? ""));
    expect(asked).toEqual(expect.arrayContaining(["hamburg", "leipzig", "atlantis"]));
    expect(nominatim.asked.every((a) => a.agent.startsWith("NEXORA-ONE"))).toBe(true);
    // Only place names go out: no buyer's name.
    expect(nominatim.asked.some((a) => /muster|eva/i.test(a.url))).toBe(false);

    const map = await shipmentMap(ctx);
    expect(map.find((p) => p.id === shipment.id)).toMatchObject({ orderId: order.id, client: "Eva Muster", carrier: "dhl", status: "IN_TRANSIT", place: "LEIPZIG", lat: 51.3397, lng: 12.3731 });
    expect(map.find((p) => p.client === "Eva Nirgends")).toMatchObject({ place: "Atlantis", lat: null });

    // Known places — found or not — are not asked again.
    const again = fakeNominatim();
    await locatePlaces(again.fetcher, 20, 0);
    expect(again.asked.map((a) => a.url).filter((u) => /hamburg|leipzig|atlantis/.test(u))).toEqual([]);
  });

  it("asks again after a failed question, and keeps each company's parcels to itself", async () => {
    const ctx = await newCompany("Ausfall GmbH");
    await parcel(ctx, "Ausfall", ["Erfurt Hbf"]);
    await locatePlaces(fakeNominatim(true).fetcher, 20, 0);
    const keys = (await getDb().select({ key: geoPlaces.key }).from(geoPlaces)).map((r) => r.key);
    expect(keys).not.toContain(placeKey("Erfurt Hbf"));
    const later = fakeNominatim();
    await locatePlaces(later.fetcher, 20, 0);
    expect(later.asked.some((a) => a.url.includes("erfurt"))).toBe(true);

    const other = await newCompany("Fremd GmbH");
    expect(await shipmentMap(other)).toEqual([]);
    const viewer = await newMember(ctx, "VIEWER");
    expect((await shipmentMap(viewer)).length).toBe(1);
  });

  it("is for those who may see orders", async () => {
    const ctx = await newCompany("Rechte Karte GmbH");
    const none = await newMember(ctx, "VIEWER");
    await expect(shipmentMap({ ...none, permissions: new Set() })).rejects.toMatchObject({ permission: "orders.read" });
    expect(placeKey("  Frankfurt   am  Main ")).toBe("frankfurt am main");
  });
});
