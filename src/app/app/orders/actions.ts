"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { invoiceFromOrder } from "@/server/invoices";
import { createOrder, deleteOrder, duplicateOrder, setOrderStatus, updateOrder, type OrderStatus } from "@/server/orders";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export type ActionResult = { ok?: boolean; id?: string; error?: "forbidden" | "notFound" | "check" | "state"; code?: string; missing?: string[] };

function failure(e: unknown): ActionResult {
  if (e instanceof ForbiddenError) return { error: "forbidden" };
  if (e instanceof NotFoundError) return { error: "notFound" };
  if (e instanceof ZodError) return { error: "check" };
  const coded = e as { code?: unknown; missing?: unknown };
  if (typeof coded?.code === "string" && /^[A-Z_]+$/.test(coded.code)) {
    return { error: "state", code: coded.code, missing: Array.isArray(coded.missing) ? (coded.missing as string[]) : undefined };
  }
  throw e;
}

const refresh = () => {
  revalidatePath("/app/orders");
  revalidatePath("/app");
};

export async function saveOrderAction(id: string | null, payload: unknown): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    const order = id ? await updateOrder(ctx, id, payload as never) : await createOrder(ctx, payload as never);
    refresh();
    return { ok: true, id: order.id };
  } catch (e) {
    return failure(e);
  }
}

export async function orderStatusAction(id: string, status: OrderStatus): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await setOrderStatus(ctx, id, status);
    refresh();
    return { ok: true, id };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteOrderAction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await deleteOrder(ctx, id);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function duplicateOrderAction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    const order = await duplicateOrder(ctx, id);
    refresh();
    return { ok: true, id: order.id };
  } catch (e) {
    return failure(e);
  }
}

export async function orderToInvoiceAction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    const invoice = await invoiceFromOrder(ctx, id);
    revalidatePath("/app/invoices");
    return { ok: true, id: invoice.id };
  } catch (e) {
    return failure(e);
  }
}
