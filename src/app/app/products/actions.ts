"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { adjustStock, InventoryError } from "@/server/inventory";
import { parseMoney } from "@/server/money";
import { ForbiddenError } from "@/server/permissions";
import { deleteProduct, saveProduct } from "@/server/products";
import { requireContext } from "@/server/request";

export type ProductResult = { ok?: boolean; error?: "forbidden" | "notFound" | "check" | "state" };

export type ProductPayload = {
  kind: string;
  name: string;
  sku: string;
  unit: string;
  price: string;
  vatRate: number;
  active: boolean;
  description: string;
  category: string;
  barcode: string;
  purchasePrice: string;
  trackStock: boolean;
  minStock: string;
};

const quantity = (text: string) => {
  const n = Number(text.trim().replace(/\./g, "").replace(",", "."));
  return text.trim() && Number.isFinite(n) ? n : null;
};

export async function saveProductAction(id: string | null, input: ProductPayload): Promise<ProductResult> {
  const ctx = await requireContext();
  const cents = parseMoney(input.price);
  const purchase = input.purchasePrice.trim() ? parseMoney(input.purchasePrice) : null;
  if (cents === null || cents < 0 || (input.purchasePrice.trim() && (purchase === null || purchase < 0))) return { error: "check" };
  try {
    await saveProduct(
      ctx,
      {
        kind: input.kind as never,
        name: input.name,
        sku: input.sku,
        unit: input.unit,
        priceCents: cents,
        vatRate: input.vatRate,
        active: input.active,
        description: input.description,
        category: input.category,
        barcode: input.barcode,
        purchasePriceCents: purchase,
        trackStock: input.trackStock,
        minStock: quantity(input.minStock),
      },
      id ?? undefined,
    );
    revalidatePath("/app/products");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    if (e instanceof NotFoundError) return { error: "notFound" };
    if (e instanceof ZodError) return { error: "check" };
    throw e;
  }
}

export async function adjustStockAction(id: string, counted: string, note: string): Promise<ProductResult> {
  const ctx = await requireContext();
  const value = quantity(counted);
  if (value === null) return { error: "check" };
  try {
    await adjustStock(ctx, id, { counted: value, note });
    revalidatePath("/app/products");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    if (e instanceof NotFoundError) return { error: "notFound" };
    if (e instanceof InventoryError) return { error: "state" };
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
