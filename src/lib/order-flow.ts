/**
 * The way a sold order goes: from confirmed (its goods reserved) through
 * picking and packing to shipped and delivered, and on its own track whether
 * it is paid. Service orders never enter this flow and keep their plain status.
 *
 * Names only, no database code: the order page uses them to show which steps
 * are possible next, the server uses the same rules to allow them.
 */
import type { OrderStatus } from "./domain";

export const CHANNELS = ["MANUAL", "PHONE", "EMAIL", "STORE", "MARKETPLACE", "SHOP"] as const;
export type Channel = (typeof CHANNELS)[number];

/** AT_SUPPLIER: every good of the order comes straight from suppliers (src/lib/dropship.ts) and is with them. */
export const FULFILLMENT = ["UNFULFILLED", "RESERVED", "PICKING", "PACKED", "AT_SUPPLIER", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
export type Fulfillment = (typeof FULFILLMENT)[number];

export const PAYMENT = ["UNPAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
export type Payment = (typeof PAYMENT)[number];

export const ORDER_ACTIONS = ["confirm", "pick", "pack", "ship", "deliver", "cancel", "markPaid", "markUnpaid", "refund"] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

/** Goods of these orders are held for them: they count against what is available. */
export const HOLDING: Fulfillment[] = ["RESERVED", "PICKING", "PACKED"];

/** The steps of the goods, in order, as the page draws them. */
export const STEPS: Fulfillment[] = ["RESERVED", "PICKING", "PACKED", "SHIPPED", "DELIVERED"];

/** The steps of an order whose goods all come straight from suppliers. */
export const DROP_STEPS: Fulfillment[] = ["AT_SUPPLIER", "SHIPPED", "DELIVERED"];

const FROM: Record<Exclude<OrderAction, "markPaid" | "markUnpaid" | "refund">, Fulfillment[]> = {
  confirm: ["UNFULFILLED"],
  pick: ["RESERVED"],
  pack: ["RESERVED", "PICKING"],
  ship: ["RESERVED", "PICKING", "PACKED", "AT_SUPPLIER"],
  deliver: ["SHIPPED"],
  cancel: ["UNFULFILLED", "RESERVED", "PICKING", "PACKED", "AT_SUPPLIER"],
};

export const FULFILLMENT_AFTER: Record<keyof typeof FROM, Fulfillment> = {
  confirm: "RESERVED",
  pick: "PICKING",
  pack: "PACKED",
  ship: "SHIPPED",
  deliver: "DELIVERED",
  cancel: "CANCELLED",
};

/** The plain order status that goes with each step, so lists, reports and automations stay right. */
export const STATUS_AFTER: Partial<Record<OrderAction, OrderStatus>> = {
  confirm: "CONFIRMED",
  pick: "IN_PROGRESS",
  pack: "IN_PROGRESS",
  ship: "IN_PROGRESS",
  deliver: "COMPLETED",
  cancel: "CANCELLED",
};

export function canDo(action: OrderAction, state: { fulfillment: Fulfillment; payment: Payment }): boolean {
  if (action === "markPaid") return state.payment === "UNPAID" && state.fulfillment !== "CANCELLED";
  if (action === "markUnpaid") return state.payment === "PAID" && state.fulfillment !== "CANCELLED";
  if (action === "refund") return state.payment === "PAID" || state.payment === "PARTIALLY_REFUNDED";
  return FROM[action].includes(state.fulfillment);
}

export const actionsFor = (state: { fulfillment: Fulfillment; payment: Payment }) => ORDER_ACTIONS.filter((a) => canDo(a, state));

/** Lines may change only while nothing is held or sent for them. */
export const linesLocked = (fulfillment: Fulfillment) => fulfillment !== "UNFULFILLED" && fulfillment !== "CANCELLED";
