import { getT } from "@/i18n/server";
import { getPurchaseOrder, listPurchaseOrders, listSuppliers, lowStock } from "@/server/inventory";
import { listProducts } from "@/server/products";
import { requirePageContext } from "@/server/request";
import { PurchasingView } from "./purchasing-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("inventory.title") };
}

export default async function PurchasingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageContext("orders.read");
  const sp = await searchParams;
  const [orders, suppliers, products, low] = await Promise.all([listPurchaseOrders(ctx), listSuppliers(ctx), listProducts(ctx, { activeOnly: true }), lowStock(ctx)]);
  const details = await Promise.all(orders.filter((o) => o.status !== "RECEIVED" && o.status !== "CANCELLED").map((o) => getPurchaseOrder(ctx, o.id)));
  return (
    <PurchasingView
      tab={sp.tab === "suppliers" ? "suppliers" : "orders"}
      canManage={ctx.permissions.has("inventory.manage")}
      orders={orders.map((o) => ({
        id: o.id,
        number: o.number,
        supplierId: o.supplierId,
        supplierName: o.supplierName,
        status: o.status,
        expectedOn: o.expectedOn,
        notes: o.notes,
        totalCents: o.totalCents,
        createdAt: o.createdAt.toISOString(),
        items:
          details
            .find((d) => d.po.id === o.id)
            ?.items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity), unitCostCents: i.unitCostCents, name: i.name, unit: i.unit })) ?? [],
      }))}
      suppliers={suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        contactName: s.contactName,
        email: s.email,
        phone: s.phone,
        street: s.street,
        postalCode: s.postalCode,
        city: s.city,
        country: s.country,
        notes: s.notes,
      }))}
      products={products.filter((p) => p.kind === "PRODUCT").map((p) => ({ id: p.id, name: p.name, unit: p.unit, purchasePriceCents: p.purchasePriceCents }))}
      lowStock={low.map((l) => ({ id: l.id, name: l.name, unit: l.unit, stock: Number(l.stock), min: Number(l.min) }))}
    />
  );
}
