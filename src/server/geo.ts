/**
 * Where parcels are, for the shipment map.
 *
 * Carriers report a place as text ("Leipzig"). Those place names — and only
 * those, never a buyer's name or address — are looked up once at
 * OpenStreetMap's Nominatim and kept in geo_places for every company, so the
 * same town is asked for a single time. Nominatim allows one question a
 * second; the scheduler asks a few at a time and the map shows what is known.
 */
import { and, desc, eq, gt, inArray, isNotNull, notInArray, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { clients, geoPlaces, orders, shipmentEvents, shipments } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { FINAL, trackingUrl } from "@/lib/shipping";
import { displayName } from "./clients";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

/** The same place however it was written: "  LEIPZIG " and "leipzig" are one. */
export const placeKey = (place: string): string => place.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 120);

export type GeoFetch = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
/** Parcels delivered this long ago still show on the map. */
const RECENT_DAYS = 14;
const DAY = 86_400_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Looks up places parcels reported that are not known yet; at most `limit`,
 * one a second. A place Nominatim does not know is kept as not found; a
 * failed question is asked again next time.
 */
export async function locatePlaces(fetcher: GeoFetch = fetch as unknown as GeoFetch, limit = 20, pause = 1100, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - RECENT_DAYS * DAY);
  const rows = await getDb()
    .selectDistinct({ location: shipmentEvents.location })
    .from(shipmentEvents)
    .innerJoin(shipments, eq(shipments.id, shipmentEvents.shipmentId))
    .where(and(isNotNull(shipmentEvents.location), or(notInArray(shipments.status, FINAL), gt(shipments.updatedAt, since))))
    .limit(500);
  const keys = [...new Set(rows.map((r) => placeKey(r.location ?? "")).filter((k) => k.length >= 2))];
  if (!keys.length) return 0;
  const known = new Set((await getDb().select({ key: geoPlaces.key }).from(geoPlaces).where(inArray(geoPlaces.key, keys))).map((r) => r.key));
  const todo = keys.filter((k) => !known.has(k)).slice(0, limit);
  let found = 0;
  for (const [i, key] of todo.entries()) {
    if (i > 0 && pause > 0) await wait(pause);
    const answer = await fetcher(`${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent(key)}`, {
      headers: { "User-Agent": "NEXORA-ONE/1.0 shipment-map", Accept: "application/json", "Accept-Language": "de,en" },
    }).catch(() => null);
    if (!answer?.ok) continue;
    const body = (await answer.json().catch(() => null)) as { lat?: string; lon?: string; display_name?: string }[] | null;
    if (!Array.isArray(body)) continue;
    const first = body[0];
    const lat = Number(first?.lat);
    const lng = Number(first?.lon);
    const ok = !!first && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    await getDb()
      .insert(geoPlaces)
      .values({ key, found: ok, lat: ok ? lat : null, lng: ok ? lng : null, label: ok ? (first.display_name ?? "").slice(0, 300) || null : null, checkedAt: now })
      .onConflictDoNothing();
    if (ok) found++;
  }
  return found;
}

export type MapParcel = {
  id: string;
  orderId: string;
  number: number;
  client: string;
  carrier: string;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  problem: string | null;
  shippedAt: string | null;
  lastAt: string | null;
  place: string | null;
  lat: number | null;
  lng: number | null;
};

export type MapFilter = "open" | "recent";

/** A company's parcels on their way (or, with "recent", also those delivered in the last two weeks) and where each last was. */
export async function shipmentMap(ctx: Context, filter: MapFilter = "open", now = new Date()): Promise<MapParcel[]> {
  requirePermission(ctx.permissions, "orders.read");
  const since = new Date(now.getTime() - RECENT_DAYS * DAY);
  const rows = await withTenant(ctx.organization.id, async (tx) => {
    const parcels = await tx
      // Flat: a nested object of a left-joined table comes back null when its first field is.
      .select({ s: shipments, number: orders.number, companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName })
      .from(shipments)
      .innerJoin(orders, eq(orders.id, shipments.orderId))
      .leftJoin(clients, eq(clients.id, orders.clientId))
      .where(filter === "open" ? notInArray(shipments.status, FINAL) : or(notInArray(shipments.status, FINAL), gt(shipments.updatedAt, since)))
      .orderBy(desc(shipments.lastEventAt))
      .limit(300);
    const events = parcels.length
      ? await tx
          .select({ shipmentId: shipmentEvents.shipmentId, location: shipmentEvents.location, at: shipmentEvents.occurredAt })
          .from(shipmentEvents)
          .where(and(inArray(shipmentEvents.shipmentId, parcels.map((p) => p.s.id)), isNotNull(shipmentEvents.location)))
          .orderBy(desc(shipmentEvents.occurredAt), desc(shipmentEvents.createdAt))
      : [];
    return { parcels, events };
  });
  const lastPlace = new Map<string, string>();
  for (const e of rows.events) if (e.location && !lastPlace.has(e.shipmentId)) lastPlace.set(e.shipmentId, e.location);
  const keys = [...new Set([...lastPlace.values()].map(placeKey))];
  const places = keys.length ? await getDb().select().from(geoPlaces).where(and(inArray(geoPlaces.key, keys), eq(geoPlaces.found, true))) : [];
  const at = new Map(places.map((p) => [p.key, p]));
  return rows.parcels.map(({ s, number, companyName, firstName, lastName }) => {
    const place = lastPlace.get(s.id) ?? null;
    const geo = place ? at.get(placeKey(place)) : undefined;
    return {
      id: s.id,
      orderId: s.orderId,
      number,
      client: companyName || firstName || lastName ? displayName({ companyName, firstName, lastName }) : "",
      carrier: s.carrier,
      carrierName: s.carrierName,
      trackingNumber: s.trackingNumber,
      trackingUrl: trackingUrl(s.carrier, s.trackingNumber),
      status: s.status,
      problem: s.problem,
      shippedAt: s.shippedAt?.toISOString() ?? null,
      lastAt: s.lastEventAt?.toISOString() ?? null,
      place,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
    };
  });
}
