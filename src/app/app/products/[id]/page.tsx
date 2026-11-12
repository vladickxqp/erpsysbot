import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { allowedRates } from "@/lib/countries";
import type { VariantOption } from "@/lib/variants";
import { getProductDetail, listCategories } from "@/server/catalog";
import { NotFoundError } from "@/server/clients";
import { dropshipOverview } from "@/server/dropship";
import { listSuppliers } from "@/server/inventory";
import { heldForProduct } from "@/server/order-flow";
import { requirePageContext } from "@/server/request";
import { ProductEditor, type EditorProduct } from "./product-editor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
  const { id } = await params;
  return { title: id === "new" ? t("products.new") : t("products.title") };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageContext(id === "new" ? "products.manage" : "orders.read");
  const [categories, suppliers] = await Promise.all([listCategories(ctx), listSuppliers(ctx)]);
  const detail =
    id === "new"
      ? null
      : await getProductDetail(ctx, id).catch((e) => {
          if (e instanceof NotFoundError) notFound();
          throw e;
        });
  const p = detail?.product;
  const held = p?.trackStock ? await heldForProduct(ctx, p.id) : { total: 0, byVariant: {} };
  const dropship = p && p.fulfillment === "DROPSHIP" ? await dropshipOverview(ctx, p.id) : null;
  const product: EditorProduct | null = p
    ? {
        id: p.id,
        kind: p.kind,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        description: p.description,
        unit: p.unit,
        priceCents: p.priceCents,
        purchasePriceCents: p.purchasePriceCents,
        vatRate: p.vatRate,
        active: p.active,
        categoryId: p.categoryId,
        trackStock: p.trackStock,
        fulfillment: p.fulfillment === "DROPSHIP" ? "DROPSHIP" : "STOCK",
        stock: Number(p.stockQuantity),
        minStock: p.minStock === null ? null : Number(p.minStock),
        weightGrams: p.weightGrams,
        lengthMm: p.lengthMm,
        widthMm: p.widthMm,
        heightMm: p.heightMm,
        attributes: (p.attributes ?? {}) as Record<string, string>,
        variantOptions: (p.variantOptions ?? []) as VariantOption[],
        shippingCostCents: p.shippingCostCents,
        otherCostCents: p.otherCostCents,
        returnable: p.returnable,
        returnDays: p.returnDays,
        shippingNote: p.shippingNote,
        importId: p.importId,
      }
    : null;
  return (
    <ProductEditor
      product={product}
      variants={(detail?.variants ?? []).map((v) => ({
        id: v.id,
        options: v.options as Record<string, string>,
        sku: v.sku,
        barcode: v.barcode,
        priceCents: v.priceCents,
        purchasePriceCents: v.purchasePriceCents,
        stock: Number(v.stockQuantity),
        minStock: v.minStock === null ? null : Number(v.minStock),
        active: v.active,
        margins: v.margins,
      }))}
      images={detail?.images ?? []}
      offers={(detail?.offers ?? []).map((o) => ({
        id: o.id,
        supplierId: o.supplierId,
        supplierName: o.supplier.name,
        variantId: o.variantId,
        supplierSku: o.supplierSku,
        purchasePriceCents: o.purchasePriceCents,
        currency: o.currency,
        minOrderQty: o.minOrderQty === null ? null : Number(o.minOrderQty),
        leadTimeDays: o.leadTimeDays ?? o.supplier.deliveryDays,
        shippingCostCents: o.shippingCostCents,
        preferred: o.preferred,
        notes: o.notes,
        supplierStock: o.supplierStock === null ? null : Number(o.supplierStock),
        stockReportedAt: o.stockReportedAt?.toISOString() ?? null,
        priceChangedAt: o.priceChangedAt?.toISOString() ?? null,
        previousPriceCents: o.previousPriceCents,
        history: o.history.map((h) => ({ priceCents: h.purchasePriceCents, currency: h.currency, at: h.recordedAt.toISOString() })),
      }))}
      bestOfferId={detail?.bestOfferId ?? null}
      dropship={dropship}
      held={held}
      movements={(detail?.movements ?? []).map((m) => ({ id: m.id, type: m.type, quantity: Number(m.quantity), variantId: m.variantId, note: m.note, at: m.createdAt.toISOString() }))}
      margins={detail?.margins ?? null}
      fees={detail?.fees ?? null}
      categories={categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }))}
      suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, currency: s.currency, active: s.status !== "INACTIVE" }))}
      rates={allowedRates(ctx.organization.taxRates, ctx.organization.country)}
      smallBusiness={ctx.organization.smallBusiness}
      can={{ manage: ctx.permissions.has("products.manage"), stock: ctx.permissions.has("inventory.manage"), settings: ctx.permissions.has("settings.manage") }}
    />
  );
}
