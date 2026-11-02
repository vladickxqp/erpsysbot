import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { NotFoundError } from "@/server/clients";
import { totals } from "@/server/money";
import { asLines, getOrder } from "@/server/orders";
import { requirePageContext } from "@/server/request";
import { OrderDetail } from "./order-detail";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("orders.read");
  const { t } = await getT();
  const found = await getOrder(ctx, (await params).id).catch(() => null);
  return { title: found ? `${t("orders.title")} #${found.order.number}` : undefined };
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("orders.read");
  const { id } = await params;
  const found = await getOrder(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { order, items, clientName } = found;
  const sum = totals(asLines(items), ctx.organization.smallBusiness);
  return (
    <OrderDetail
      order={{
        id: order.id,
        number: order.number,
        status: order.status,
        title: order.title,
        notes: order.notes,
        dueDate: order.dueDate,
        clientId: order.clientId,
        createdAt: order.createdAt.toISOString(),
      }}
      clientName={clientName}
      items={items.map((i) => ({
        id: i.id,
        position: i.position,
        description: i.description,
        quantity: Number(i.quantity),
        unit: i.unit,
        unitPriceCents: i.unitPriceCents,
        discountPercent: Number(i.discountPercent),
        vatRate: i.vatRate,
        netCents: i.netCents,
      }))}
      totals={sum}
      smallBusiness={ctx.organization.smallBusiness}
      can={{
        update: ctx.permissions.has("orders.update"),
        delete: ctx.permissions.has("orders.delete"),
        create: ctx.permissions.has("orders.create"),
        invoice: ctx.permissions.has("invoices.create"),
      }}
    />
  );
}
