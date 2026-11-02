import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { listProducts } from "@/server/products";
import { requirePageContext } from "@/server/request";
import { ProductsView } from "./products-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("products.title") };
}

export default async function ProductsPage() {
  const ctx = await requirePageContext("orders.read");
  const { t } = await getT();
  const rows = await listProducts(ctx);
  return (
    <>
      <PageHeader title={t("products.title")} />
      <ProductsView
        rows={rows.map((p) => ({
          id: p.id,
          kind: p.kind,
          name: p.name,
          sku: p.sku,
          description: p.description,
          unit: p.unit,
          priceCents: p.priceCents,
          vatRate: p.vatRate,
          active: p.active,
          category: p.category,
          barcode: p.barcode,
          purchasePriceCents: p.purchasePriceCents,
          trackStock: p.trackStock,
          stock: Number(p.stockQuantity),
          minStock: p.minStock === null ? null : Number(p.minStock),
        }))}
        canManage={ctx.permissions.has("products.manage")}
        canStock={ctx.permissions.has("inventory.manage")}
        smallBusiness={ctx.organization.smallBusiness}
      />
    </>
  );
}
