import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { listProducts } from "@/server/products";
import { requireContext } from "@/server/request";
import { ProductsView } from "./products-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("products.title") };
}

export default async function ProductsPage() {
  const ctx = await requireContext();
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
        }))}
        canManage={ctx.permissions.has("products.manage")}
        smallBusiness={ctx.organization.smallBusiness}
      />
    </>
  );
}
