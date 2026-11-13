/**
 * Returns and refunds: what a buyer may send back, the way a return goes,
 * the supplier's side of it and the money. A customer's return never means
 * the supplier took the goods back, and a refund to the customer never means
 * the supplier paid: both are tracked on their own.
 *
 * Names and rules only; the server and the pages use the same.
 */

export const RETURN_STATUSES = [
  "REQUESTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "LABEL_PENDING",
  "SHIPPED",
  "RECEIVED",
  "INSPECTION",
  "REFUND_PENDING",
  "REFUNDED",
  "CLOSED",
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** Where a return may go next. Closing is always possible (with a note), except once closed. */
const NEXT: Record<ReturnStatus, ReturnStatus[]> = {
  REQUESTED: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["LABEL_PENDING", "SHIPPED", "RECEIVED"],
  REJECTED: [],
  LABEL_PENDING: ["SHIPPED", "RECEIVED"],
  SHIPPED: ["RECEIVED"],
  RECEIVED: ["INSPECTION", "REFUND_PENDING"],
  INSPECTION: ["REFUND_PENDING"],
  REFUND_PENDING: ["REFUNDED"],
  REFUNDED: [],
  CLOSED: [],
};

export function canMove(from: ReturnStatus, to: ReturnStatus): boolean {
  if (to === "CLOSED") return from !== "CLOSED";
  return NEXT[from].includes(to);
}

export const nextSteps = (from: ReturnStatus): ReturnStatus[] => [...NEXT[from], ...(from !== "CLOSED" ? (["CLOSED"] as ReturnStatus[]) : [])];

/** Steps a person takes by hand; REFUNDED follows from the refunds themselves. */
export const MANUAL_STEPS: ReturnStatus[] = ["UNDER_REVIEW", "APPROVED", "REJECTED", "LABEL_PENDING", "SHIPPED", "RECEIVED", "INSPECTION", "REFUND_PENDING", "CLOSED"];

/** The goods are with the company again: they may be inspected, put back on the shelf and refunded. */
export const RECEIVED_STATES: ReturnStatus[] = ["RECEIVED", "INSPECTION", "REFUND_PENDING", "REFUNDED", "CLOSED"];

/** Still open: counts against what may be returned again. */
export const OPEN_STATES: ReturnStatus[] = RETURN_STATUSES.filter((s) => s !== "REJECTED" && s !== "CLOSED");

export const RETURN_REASONS = ["DAMAGED", "DEFECTIVE", "WRONG_ITEM", "NOT_AS_DESCRIBED", "CHANGED_MIND", "LATE", "OTHER"] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const RESOLUTIONS = ["REFUND", "EXCHANGE", "REPAIR"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const CONDITIONS = ["AS_NEW", "OPENED", "DAMAGED"] as const;
export type Condition = (typeof CONDITIONS)[number];

/** In Germany a consumer may withdraw from a distance sale within 14 days; a product may allow longer, never shorter. */
export const LEGAL_RETURN_DAYS = 14;
const DAY = 86_400_000;

/** Until when a product may be sent back, counted from delivery (or shipping, when delivery was not recorded). */
export function returnableUntil(product: { returnable: boolean; returnDays: number | null } | null, order: { deliveredAt: Date | null; shippedAt: Date | null }): Date | null {
  if (product && !product.returnable) return null;
  const from = order.deliveredAt ?? order.shippedAt;
  if (!from) return null;
  const days = Math.max(LEGAL_RETURN_DAYS, product?.returnDays ?? LEGAL_RETURN_DAYS);
  return new Date(from.getTime() + days * DAY);
}

export const SUPPLIER_RETURN_STATUSES = ["REQUESTED", "APPROVED", "REJECTED", "SHIPPED", "RECEIVED", "REFUNDED", "COMPENSATED", "CLOSED"] as const;
export type SupplierReturnStatus = (typeof SUPPLIER_RETURN_STATUSES)[number];

const SUPPLIER_NEXT: Record<SupplierReturnStatus, SupplierReturnStatus[]> = {
  REQUESTED: ["APPROVED", "REJECTED"],
  APPROVED: ["SHIPPED", "REFUNDED", "COMPENSATED"],
  REJECTED: [],
  SHIPPED: ["RECEIVED"],
  RECEIVED: ["REFUNDED", "COMPENSATED"],
  REFUNDED: [],
  COMPENSATED: [],
  CLOSED: [],
};

export function canMoveSupplier(from: SupplierReturnStatus, to: SupplierReturnStatus): boolean {
  if (to === "CLOSED") return from !== "CLOSED";
  return SUPPLIER_NEXT[from].includes(to);
}

export const supplierSteps = (from: SupplierReturnStatus): SupplierReturnStatus[] => [...SUPPLIER_NEXT[from], ...(from !== "CLOSED" ? (["CLOSED"] as SupplierReturnStatus[]) : [])];

/** The supplier paid back or made good: an amount is recorded with it. */
export const SUPPLIER_PAID: SupplierReturnStatus[] = ["REFUNDED", "COMPENSATED"];

export const REFUND_STATUSES = ["PENDING", "SUCCEEDED", "FAILED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** stripe: through the store's own Stripe account; bank: the company transfers it; manual: cash or otherwise, already done. */
export const REFUND_PROVIDERS = ["stripe", "bank", "manual"] as const;
export type RefundProvider = (typeof REFUND_PROVIDERS)[number];

/** The gross amount of part of an order line: net per unit plus tax, rounded to the cent. */
export function lineGrossCents(line: { netCents: number; quantity: number; vatRate: number }, quantity: number, smallBusiness: boolean): number {
  if (!line.quantity) return 0;
  const net = (line.netCents / line.quantity) * quantity;
  return Math.round(smallBusiness ? net : net * (1 + line.vatRate / 100));
}
