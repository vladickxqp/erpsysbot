"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { ORDER_ACTIONS, type OrderAction } from "@/lib/order-flow";
import { NotFoundError } from "@/server/clients";
import { OrderFlowError, runOrderAction, saveShipping, type ActionInput, type ShippingInput } from "@/server/order-flow";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export type FlowResult = { ok?: boolean; error?: string; short?: { description: string; needed: number; available: number }[] };

function failure(e: unknown): FlowResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  if (e instanceof OrderFlowError) return { error: `orderFlow.error.${e.code}`, short: e.lines.length ? e.lines : undefined };
  throw e;
}

const refresh = (id: string) => {
  revalidatePath(`/app/orders/${id}`);
  revalidatePath("/app/orders");
  revalidatePath("/app/products", "layout");
  revalidatePath("/app");
};

export async function orderStepAction(id: string, action: OrderAction, input: ActionInput = {}): Promise<FlowResult> {
  const ctx = await requireContext();
  if (!ORDER_ACTIONS.includes(action)) return { error: "auth.check" };
  try {
    await runOrderAction(ctx, id, action, input);
    refresh(id);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function saveShippingAction(id: string, input: ShippingInput): Promise<FlowResult> {
  const ctx = await requireContext();
  try {
    await saveShipping(ctx, id, input);
    refresh(id);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
