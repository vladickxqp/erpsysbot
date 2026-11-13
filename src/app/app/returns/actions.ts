"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import type { ReturnStatus, SupplierReturnStatus } from "@/lib/returns";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { cancelRefund, markRefundSent, RefundError, refundOrder, type RefundInput } from "@/server/refunds";
import { requireContext } from "@/server/request";
import { createReturn, moveReturn, moveSupplierReturn, openSupplierReturns, ReturnError, saveReturnDetails, type ReturnInput, type StepInput } from "@/server/returns";
import { addShipment, addShipmentEvent, saveShipment, type ShipmentEventInput, type ShipmentInput } from "@/server/shipments";

export type AfterSaleResult = { ok?: boolean; id?: string; error?: string };

function failure(e: unknown): AfterSaleResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "aftersales.error.FORM" };
  if (e instanceof ReturnError || e instanceof RefundError) return { error: `aftersales.error.${e.code}` };
  throw e;
}

async function run(work: () => Promise<AfterSaleResult | void>): Promise<AfterSaleResult> {
  try {
    const result = (await work()) ?? {};
    revalidatePath("/app/returns", "layout");
    revalidatePath("/app/orders", "layout");
    return { ok: true, ...result };
  } catch (e) {
    return failure(e);
  }
}

export async function createReturnAction(orderId: string, input: ReturnInput): Promise<AfterSaleResult> {
  const ctx = await requireContext();
  return run(async () => ({ id: (await createReturn(ctx, orderId, input)).id }));
}

export async function moveReturnAction(id: string, to: ReturnStatus, input: StepInput = {}): Promise<AfterSaleResult> {
  const ctx = await requireContext();
  return run(() => moveReturn(ctx, id, to, input));
}

export async function saveReturnDetailsAction(id: string, input: { note: string | null; refundCents: number }): Promise<AfterSaleResult> {
  const ctx = await requireContext();
  return run(() => saveReturnDetails(ctx, id, input));
}

export async function openSupplierReturnsAction(id: string): Promise<AfterSaleResult> {
  const ctx = await requireContext();
  return run(async () => {
    await openSupplierReturns(ctx, id);
  });
}

export async function moveSupplierReturnAction(id: string, to: SupplierReturnStatus, input: { settledCents?: number | null; reference?: string | null; note?: string | null } = {}): Promise<AfterSaleResult> {
  const ctx = await requireContext();
  return run(() => moveSupplierReturn(ctx, id, to, input));
}

export async function refundAction(orderId: string, input: RefundInput): Promise<AfterSaleResult> {
  const ctx = await requireContext();
  return run(async () => ({ id: (await refundOrder(ctx, orderId, input)).id }));
}

export async function markRefundSentAction(id: string, reference: string | null): Promise<AfterSaleResult> {
  const ctx = await requireContext();
  return run(() => markRefundSent(ctx, id, { reference }));
}

export async function cancelRefundAction(id: string): Promise<AfterSaleResult> {
  const ctx = await requireContext();
  return run(() => cancelRefund(ctx, id));
}

export async function addShipmentAction(orderId: string, input: ShipmentInput): Promise<AfterSaleResult> {
  const ctx = await requireContext();
  return run(() => addShipment(ctx, orderId, input));
}

export async function saveShipmentAction(id: string, input: ShipmentInput): Promise<AfterSaleResult> {
  const ctx = await requireContext();
  return run(() => saveShipment(ctx, id, input));
}

export async function addShipmentEventAction(id: string, input: ShipmentEventInput): Promise<AfterSaleResult> {
  const ctx = await requireContext();
  return run(() => addShipmentEvent(ctx, id, input));
}
