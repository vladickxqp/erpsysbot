/**
 * Shipments: who carries a parcel, its tracking number, where it is and what
 * went wrong. Carriers differ — some have a tracking page, one (DHL) a
 * tracking interface; nothing here assumes they work alike. Only what a
 * person entered or a carrier reported is shown: no tracking is invented.
 *
 * Names and rules only; the server and the pages use the same.
 */

export const CARRIERS = ["dhl", "dpd", "gls", "hermes", "ups", "post", "fedex", "other"] as const;
export type Carrier = (typeof CARRIERS)[number];

/** The carrier's own tracking page for a number (none for "other"). */
const TRACK_URL: Record<Carrier, string | null> = {
  dhl: "https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode={n}",
  dpd: "https://tracking.dpd.de/status/de_DE/parcel/{n}",
  gls: "https://gls-group.com/DE/de/paketverfolgung?match={n}",
  hermes: "https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation/#{n}",
  ups: "https://www.ups.com/track?tracknum={n}",
  post: "https://www.deutschepost.de/de/s/sendungsverfolgung.html?piececode={n}",
  fedex: "https://www.fedex.com/fedextrack/?trknbr={n}",
  other: null,
};

/** A carrier from what a person or an older order wrote ("DHL Paket" → dhl); unknown ones are "other". */
export function carrierOf(raw: string | null | undefined): Carrier {
  const v = (raw ?? "").toLowerCase();
  if (/dhl/.test(v)) return "dhl";
  if (/dpd/.test(v)) return "dpd";
  if (/gls/.test(v)) return "gls";
  if (/hermes/.test(v)) return "hermes";
  if (/\bups\b/.test(v)) return "ups";
  if (/post/.test(v)) return "post";
  if (/fedex/.test(v)) return "fedex";
  return (CARRIERS as readonly string[]).includes(v) ? (v as Carrier) : "other";
}

/** Tracking numbers are letters and digits; anything else is not put into a link. */
export const TRACKING = /^[A-Za-z0-9][A-Za-z0-9 -]{3,38}[A-Za-z0-9]$/;

export function trackingUrl(carrier: string | null | undefined, number: string | null | undefined): string | null {
  const template = TRACK_URL[carrierOf(carrier)];
  const n = (number ?? "").trim();
  if (!template || !TRACKING.test(n)) return null;
  return template.replace("{n}", encodeURIComponent(n.replace(/\s+/g, "")));
}

export const SHIPMENT_STATUSES = ["CREATED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_ATTEMPT", "EXCEPTION", "RETURNED_TO_SENDER", "LOST"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export const isShipmentStatus = (v: unknown): v is ShipmentStatus => typeof v === "string" && (SHIPMENT_STATUSES as readonly string[]).includes(v);

/** A parcel that arrived, came back or is gone no longer moves. */
export const FINAL: ShipmentStatus[] = ["DELIVERED", "RETURNED_TO_SENDER", "LOST"];

export const PROBLEMS = ["MISSING_TRACKING", "DELAYED", "FAILED", "EXCEPTION", "LOST"] as const;
export type Problem = (typeof PROBLEMS)[number];

/** Days after shipping a parcel counts as late; a day without a tracking number is too long. */
export const DELAY_DAYS = 7;
const DAY = 86_400_000;

/** What is wrong with a shipment now, or null; the carrier's own words decide first. */
export function problemOf(s: { status: string; trackingNumber: string | null; shippedAt: Date | null }, now: Date, delayDays = DELAY_DAYS): Problem | null {
  if (s.status === "LOST") return "LOST";
  if (s.status === "EXCEPTION") return "EXCEPTION";
  if (s.status === "FAILED_ATTEMPT") return "FAILED";
  if (FINAL.includes(s.status as ShipmentStatus) || !s.shippedAt) return null;
  const age = now.getTime() - s.shippedAt.getTime();
  if (!s.trackingNumber && age > DAY) return "MISSING_TRACKING";
  if (age > delayDays * DAY) return "DELAYED";
  return null;
}

/** DHL's tracking interface reports a status code; this is what it means here (unknown: no change). */
export function dhlStatus(code: string | null | undefined): ShipmentStatus | null {
  switch (code) {
    case "pre-transit":
      return "CREATED";
    case "transit":
      return "IN_TRANSIT";
    case "delivered":
      return "DELIVERED";
    case "failure":
      return "EXCEPTION";
    default:
      return null;
  }
}
