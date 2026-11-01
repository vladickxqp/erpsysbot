"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { parseMoney } from "@/server/money";
import { ForbiddenError } from "@/server/permissions";
import { deleteProduct, saveProduct } from "@/server/products";
import { requireContext } from "@/server/request";

export type ProductResult = { ok?: boolean; error?: "forbidden" | "notFound" | "check" };

export async function saveProductAction(
  id: string | null,
  input: { kind: string; name: string; sku: string; unit: string; price: string; vatRate: number; active: boolean; description: string },
): Promise<ProductResult> {
  const ctx = await requireContext();
  const cents = parseMoney(input.price);
  if (cents === null || cents < 0) return { error: "check" };
  try {
    await saveProduct(ctx, { ...input, kind: input.kind as never, priceCents: cents }, id ?? undefined);
    revalidatePath("/app/products");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    if (e instanceof NotFoundError) return { error: "notFound" };
    if (e instanceof ZodError) return { error: "check" };
    throw e;
  }
}

export async function deleteProductAction(id: string): Promise<ProductResult> {
  const ctx = await requireContext();
  try {
    await deleteProduct(ctx, id);
    revalidatePath("/app/products");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    if (e instanceof NotFoundError) return { error: "notFound" };
    throw e;
  }
}
