import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { clientOptions, NotFoundError } from "@/server/clients";
import { getOrder } from "@/server/orders";
import { listProducts } from "@/server/products";
import { requireContext } from "@/server/request";
import { OrderEditor } from "./order-editor";

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { t } = await getT();
  const { id } = await params;
  const found = await getOrder(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [clients, products] = await Promise.all([clientOptions(ctx), listProducts(ctx, { activeOnly: true })]);
  const { order, items } = found;
  return (
    <>
      <PageHeader title={`${t("orders.edit")} #${order.number}`} />
      <OrderEditor
        order={{
          id: order.id,
          clientId: order.clientId,
          status: order.status,
          title: order.title ?? "",
          notes: order.notes ?? "",
          dueDate: order.dueDate ?? "",
        }}
        items={items.map((i) => ({
          productId: i.productId,
          description: i.description,
          quantity: i.quantity,
          unit: i.unit,
          unitPriceCents: i.unitPriceCents,
          discountPercent: i.discountPercent,
          vatRate: i.vatRate,
        }))}
        clients={clients}
        products={products}
        smallBusiness={ctx.organization.smallBusiness}
      />
    </>
  );
}
