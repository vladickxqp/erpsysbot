"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import {
  addProductImage,
  CatalogError,
  deleteCategory,
  deleteOffer,
  moveProductImage,
  removeProductImage,
  saveCategory,
  saveCommerceSettings,
  saveOffer,
  saveVariant,
  saveVariantOptions,
  type OfferInput,
} from "@/server/catalog";
import { NotFoundError } from "@/server/clients";
import { adjustStock, InventoryError, saveSupplier, type SupplierInput } from "@/server/inventory";
import { ForbiddenError } from "@/server/permissions";
import { activateImport, applyImport, discardImport, importPreview, ProductImportError } from "@/server/product-import";
import { deleteProduct, saveProduct, type ProductInput } from "@/server/products";
import { requireContext } from "@/server/request";
import type { VariantOption } from "@/lib/variants";

export type CatalogResult = { ok?: boolean; id?: string; error?: string; count?: number };

function failure(e: unknown): CatalogResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  if (e instanceof CatalogError) return { error: `catalog.error.${e.code}` };
  if (e instanceof InventoryError) return { error: `inventory.${e.code}` };
  if (e instanceof ProductImportError) return { error: `catalog.import.error.${e.code}` };
  throw e;
}

async function run(work: () => Promise<CatalogResult | void>, ...paths: string[]): Promise<CatalogResult> {
  try {
    const result = (await work()) ?? {};
    for (const path of ["/app/products", ...paths]) revalidatePath(path, "layout");
    return { ok: true, ...result };
  } catch (e) {
    return failure(e);
  }
}

export async function saveProductDetailsAction(id: string | null, input: ProductInput): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(async () => ({ id: (await saveProduct(ctx, input, id ?? undefined)).id }));
}

export async function deleteProductAction(id: string): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(() => deleteProduct(ctx, id));
}

export async function saveCategoryAction(id: string | null, name: string, parentId: string | null): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(async () => ({ id: (await saveCategory(ctx, id, { name, parentId })).id }));
}

export async function deleteCategoryAction(id: string): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(() => deleteCategory(ctx, id));
}

export async function saveVariantOptionsAction(productId: string, options: VariantOption[]): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(async () => ({ count: (await saveVariantOptions(ctx, productId, options)).variants }));
}

export async function saveVariantAction(
  id: string,
  input: { sku: string; barcode: string; priceCents: number | null; purchasePriceCents: number | null; minStock: number | null; active: boolean },
): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(() => saveVariant(ctx, id, input).then(() => undefined));
}

export async function countStockAction(productId: string, variantId: string | null, counted: number, note: string): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(() => adjustStock(ctx, productId, { counted, note, variantId }));
}

export async function addImageAction(productId: string, documentId: string): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(() => addProductImage(ctx, productId, documentId));
}

export async function removeImageAction(imageId: string): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(() => removeProductImage(ctx, imageId));
}

export async function moveImageAction(imageId: string, direction: "up" | "down"): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(() => moveProductImage(ctx, imageId, direction));
}

export async function saveOfferAction(productId: string, id: string | null, input: OfferInput): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(async () => ({ id: (await saveOffer(ctx, productId, id, input)).id }), "/app/purchasing");
}

export async function deleteOfferAction(id: string): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(() => deleteOffer(ctx, id), "/app/purchasing");
}

export async function saveSupplierDetailsAction(id: string | null, input: SupplierInput): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(async () => ({ id: (await saveSupplier(ctx, id, input)).id }), "/app/purchasing");
}

export async function saveFeesAction(percent: number, fixedCents: number): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(() => saveCommerceSettings(ctx, { paymentFeePercent: percent, paymentFeeFixedCents: fixedCents }), "/app/settings");
}

export async function importMappingAction(id: string, mapping: (string | null)[]): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(() => importPreview(ctx, id, mapping).then(() => undefined));
}

export async function applyImportAction(id: string): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(async () => {
    const result = await applyImport(ctx, id);
    return { count: result.created + result.variants };
  });
}

export async function activateImportAction(id: string): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(async () => ({ count: await activateImport(ctx, id) }));
}

export async function discardImportAction(id: string): Promise<CatalogResult> {
  const ctx = await requireContext();
  return run(() => discardImport(ctx, id));
}
