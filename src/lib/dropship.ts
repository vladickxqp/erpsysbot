/**
 * Direct shipping by the supplier (dropshipping): the company sells, the
 * supplier sends the goods straight to the customer, NEXORA keeps the
 * business process together. These are its names and rules only, no database
 * code: the pages show what is possible next, the server allows the same.
 *
 * A customer order with such goods gets one supplier order per supplier. It
 * waits for the customer's payment (when the supplier's rules say so), then
 * either goes out on its own or waits for a person's yes, and is sent by the
 * way the supplier takes orders: by hand, by e-mail or through its interface.
 */

/** How a product reaches the customer: from the company's own stock or straight from a supplier. */
export const FULFILLMENT_TYPES = ["STOCK", "DROPSHIP"] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

/** How a supplier takes an order. */
export const SUBMIT_METHODS = ["MANUAL", "EMAIL", "API"] as const;
export type SubmitMethod = (typeof SUBMIT_METHODS)[number];

export const SUPPLIER_ORDER_STATUSES = [
  /** Waits for the customer's payment. */
  "WAITING",
  /** Waits for a person's yes (see `reasons`). */
  "APPROVAL",
  /** May go out: on its own by e-mail or interface, by hand otherwise. */
  "READY",
  /** Being sent; a passing failure is tried again later with the same key. */
  "SENDING",
  "SUBMITTED",
  "CONFIRMED",
  "SHIPPED",
  "DELIVERED",
  "REJECTED",
  "OUT_OF_STOCK",
  /** Could not be sent and will not be tried again on its own. */
  "FAILED",
  "CANCELLED",
] as const;
export type SupplierOrderStatus = (typeof SUPPLIER_ORDER_STATUSES)[number];

/** Still to be done: the customer order cannot be closed while one of these is open. */
export const OPEN: SupplierOrderStatus[] = ["WAITING", "APPROVAL", "READY", "SENDING", "SUBMITTED", "CONFIRMED", "REJECTED", "OUT_OF_STOCK", "FAILED"];
/** The supplier has it (or may have it): cancelling the customer order needs the supplier's cancellation first. */
export const AT_SUPPLIER: SupplierOrderStatus[] = ["SENDING", "SUBMITTED", "CONFIRMED", "SHIPPED", "DELIVERED"];
/** Not with the supplier yet: these hold the supplier's reported stock for the company. */
export const RESERVING: SupplierOrderStatus[] = ["WAITING", "APPROVAL", "READY", "SENDING"];

export const SUPPLIER_ORDER_ACTIONS = ["approve", "send", "markSubmitted", "confirm", "reject", "outOfStock", "ship", "deliver", "retry", "cancel"] as const;
export type SupplierOrderAction = (typeof SUPPLIER_ORDER_ACTIONS)[number];

const FROM: Record<SupplierOrderAction, SupplierOrderStatus[]> = {
  approve: ["APPROVAL"],
  /** Send now (e-mail, interface); a failed one too, once its cause is fixed. */
  send: ["READY", "FAILED"],
  /** Ordered by hand at the supplier, or sent another way. */
  markSubmitted: ["READY", "FAILED", "SENDING"],
  confirm: ["SUBMITTED"],
  reject: ["SUBMITTED", "CONFIRMED"],
  outOfStock: ["SUBMITTED", "CONFIRMED"],
  ship: ["SUBMITTED", "CONFIRMED"],
  deliver: ["SHIPPED"],
  /** Asks again: back to a person's yes. */
  retry: ["REJECTED", "OUT_OF_STOCK", "FAILED"],
  /** From SUBMITTED and CONFIRMED only once it was cancelled at the supplier. */
  cancel: ["WAITING", "APPROVAL", "READY", "FAILED", "REJECTED", "OUT_OF_STOCK", "SUBMITTED", "CONFIRMED"],
};

export const STATUS_AFTER: Record<Exclude<SupplierOrderAction, "send">, SupplierOrderStatus> = {
  approve: "READY",
  markSubmitted: "SUBMITTED",
  confirm: "CONFIRMED",
  reject: "REJECTED",
  outOfStock: "OUT_OF_STOCK",
  ship: "SHIPPED",
  deliver: "DELIVERED",
  retry: "APPROVAL",
  cancel: "CANCELLED",
};

export function canDoSupplier(action: SupplierOrderAction, status: SupplierOrderStatus, method: SubmitMethod): boolean {
  if (action === "send" && method === "MANUAL") return false;
  return FROM[action].includes(status);
}

export const supplierActionsFor = (status: SupplierOrderStatus, method: SubmitMethod) => SUPPLIER_ORDER_ACTIONS.filter((a) => canDoSupplier(a, status, method));

/** Why a supplier order waits for a person. */
export const REASONS = ["AMOUNT", "NEW_SUPPLIER", "PRICE", "STOCK_UNKNOWN", "STOCK_SHORT", "MARGIN", "ADDRESS", "MANUAL_RULE"] as const;
export type Reason = (typeof REASONS)[number];

/** Each supplier's own rules for what goes out without a person; all thresholds are the company's. */
export type DropshipRules = {
  /** Sent on its own up to this supplier cost (cents, net); null: never on its own. */
  autoBelowCents: number | null;
  /** Below this contribution margin (percent of the net sale) a person decides; null: no limit. */
  minMarginPercent: number | null;
  /** The first orders to a supplier need a yes. */
  approveNewSupplier: boolean;
  /** A purchase price that changed needs a yes before anything is bought at it. */
  approvePriceChange: boolean;
  /** When the supplier reported no stock, a person decides. */
  approveUnknownStock: boolean;
  /** Nothing goes to the supplier before the customer paid. */
  requirePaid: boolean;
};

export const DEFAULT_RULES: DropshipRules = {
  autoBelowCents: null,
  minMarginPercent: null,
  approveNewSupplier: true,
  approvePriceChange: true,
  approveUnknownStock: true,
  requirePaid: true,
};

/** Until this many orders went through, a supplier counts as new. */
export const NEW_SUPPLIER_ORDERS = 3;

export function cleanRules(raw: unknown): DropshipRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof DropshipRules, unknown>>;
  const count = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.round(v)) : null);
  const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    autoBelowCents: count(r.autoBelowCents, 100_000_000),
    minMarginPercent: typeof r.minMarginPercent === "number" && Number.isFinite(r.minMarginPercent) ? Math.max(-100, Math.min(100, r.minMarginPercent)) : null,
    approveNewSupplier: flag(r.approveNewSupplier, DEFAULT_RULES.approveNewSupplier),
    approvePriceChange: flag(r.approvePriceChange, DEFAULT_RULES.approvePriceChange),
    approveUnknownStock: flag(r.approveUnknownStock, DEFAULT_RULES.approveUnknownStock),
    requirePaid: flag(r.requirePaid, DEFAULT_RULES.requirePaid),
  };
}

/** What a supplier order must pass before it goes out on its own; empty: it may. */
export function reasonsFor(input: {
  rules: DropshipRules;
  costCents: number;
  /** Contribution margin in percent of the net sale; null when it cannot be told (other currency). */
  marginPercent: number | null;
  /** Orders that went through to this supplier so far. */
  doneOrders: number;
  priceChanged: boolean;
  /** Per line: what the supplier reported (null: nothing) against what is needed. */
  stock: { reported: number | null; needed: number }[];
  addressComplete: boolean;
}): Reason[] {
  const { rules } = input;
  const reasons: Reason[] = [];
  if (!input.addressComplete) reasons.push("ADDRESS");
  if (input.stock.some((s) => s.reported !== null && s.reported < s.needed)) reasons.push("STOCK_SHORT");
  if (rules.approveUnknownStock && input.stock.some((s) => s.reported === null)) reasons.push("STOCK_UNKNOWN");
  if (rules.approvePriceChange && input.priceChanged) reasons.push("PRICE");
  if (rules.minMarginPercent !== null && (input.marginPercent === null || input.marginPercent < rules.minMarginPercent)) reasons.push("MARGIN");
  if (rules.approveNewSupplier && input.doneOrders < NEW_SUPPLIER_ORDERS) reasons.push("NEW_SUPPLIER");
  if (rules.autoBelowCents === null) reasons.push("MANUAL_RULE");
  else if (input.costCents > rules.autoBelowCents) reasons.push("AMOUNT");
  return reasons;
}

/** Waiting times before the next try of a passing failure, in minutes; then it fails for good. */
export const RETRY_MINUTES = [1, 5, 30, 120, 360] as const;

export function nextTry(attempts: number, now: Date): Date | null {
  const minutes = RETRY_MINUTES[attempts - 1];
  return minutes === undefined ? null : new Date(now.getTime() + minutes * 60_000);
}

/** What the integration with a supplier can honestly be said to be. */
export const LINK_STATES = ["OFF", "SETUP", "CONFIGURED", "CONNECTED", "ERROR"] as const;
export type LinkState = (typeof LINK_STATES)[number];

export function linkState(s: {
  dropship: boolean;
  submitMethod: SubmitMethod;
  orderEmail: string | null;
  email: string | null;
  apiUrl: string | null;
  lastSubmitAt: Date | string | null;
  lastSubmitOk: boolean | null;
  mailReady: boolean;
}): LinkState {
  if (!s.dropship) return "OFF";
  if (s.submitMethod === "EMAIL" && (!(s.orderEmail || s.email) || !s.mailReady)) return "SETUP";
  if (s.submitMethod === "API" && !s.apiUrl) return "SETUP";
  if (s.submitMethod === "MANUAL") return "CONFIGURED";
  if (s.lastSubmitAt && s.lastSubmitOk === false) return "ERROR";
  if (s.lastSubmitAt && s.lastSubmitOk) return "CONNECTED";
  return "CONFIGURED";
}

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^(22[4-9]|2[3-5]\d)\./];

/** An address on the internet, not the server's own network: the app must not be made to call inside it. */
export function isPublicAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v.includes(":")) return !(v === "::" || v === "::1" || /^f[cd]/.test(v) || v.startsWith("fe80") || v.startsWith("::ffff:"));
  return /^\d+\.\d+\.\d+\.\d+$/.test(v) && !PRIVATE_V4.some((r) => r.test(v));
}

/** A supplier's interface: https, a real host name or public address, no credentials in the address. */
export function isAllowedUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return isPublicAddress(host);
  return host.includes(".") && !host.endsWith(".localhost") && !host.endsWith(".local") && !host.endsWith(".internal");
}

/** Events a supplier's system may send back. */
export const INBOUND_EVENTS = ["order.confirmed", "order.rejected", "order.out_of_stock", "order.shipped", "order.delivered", "stock.updated", "price.updated", "ping"] as const;
export type InboundEvent = (typeof INBOUND_EVENTS)[number];

export const INBOUND_ACTION: Partial<Record<InboundEvent, SupplierOrderAction>> = {
  "order.confirmed": "confirm",
  "order.rejected": "reject",
  "order.out_of_stock": "outOfStock",
  "order.shipped": "ship",
  "order.delivered": "deliver",
};
