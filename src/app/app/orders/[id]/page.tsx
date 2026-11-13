import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { NotFoundError } from "@/server/clients";
import { totals } from "@/server/money";
import { asLines, getOrder } from "@/server/orders";
import { requirePageContext } from "@/server/request";
import type { Channel, Fulfillment, Payment } from "@/lib/order-flow";
import { getOrderFlow } from "@/server/order-flow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supplierOrdersOf } from "@/server/dropship";
import { SupplierOrderList } from "../../purchasing/supplier-orders";
import { OrderDetail } from "./order-detail";
import { OrderFlowPanel } from "./order-flow-panel";
import { refundsOf } from "@/server/refunds";
import { returnableLines, returnsOfOrder } from "@/server/returns";
import { shipmentsOf } from "@/server/shipments";
import { AfterSale } from "./after-sale";

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
  // Companies that sell goods see the way of the goods; service companies keep the plain order.
  const flow = [...ctx.disabledModules].includes("products") ? null : await getOrderFlow(ctx, id);
  const supplierOrders = flow ? await supplierOrdersOf(ctx, id) : [];
  const after = flow
    ? await Promise.all([shipmentsOf(ctx, id), returnsOfOrder(ctx, id), returnableLines(ctx, id), refundsOf(ctx, id)]).then(([shipments, returns, lines, refunds]) => ({ shipments, returns, lines, refunds }))
    : null;
  const { t } = await getT();
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
      locked={order.fulfillmentStatus !== "UNFULFILLED" && order.fulfillmentStatus !== "CANCELLED"}
      flow={
        flow && (
          <>
          <OrderFlowPanel
            dropOnly={flow.dropOnly}
            orderId={order.id}
            fulfillment={order.fulfillmentStatus as Fulfillment}
            payment={order.paymentStatus as Payment}
            channel={order.channel as Channel}
            externalRef={order.externalRef}
            address={{
              shipName: order.shipName ?? "",
              shipStreet: order.shipStreet ?? "",
              shipPostalCode: order.shipPostalCode ?? "",
              shipCity: order.shipCity ?? "",
              shipCountry: order.shipCountry ?? "",
            }}
            carrier={order.carrier}
            trackingNumber={order.trackingNumber}
            lines={flow.lines.map((l) => ({ id: l.id, description: l.description, needed: l.needed, available: l.available, enough: l.enough }))}
            events={flow.events.map((e) => {
              const data = (e.data ?? {}) as { note?: string; carrier?: string; trackingNumber?: string };
              return { id: e.id, kind: e.kind, at: e.createdAt.toISOString(), note: data.note ?? null, carrier: data.carrier ?? null, trackingNumber: data.trackingNumber ?? null };
            })}
            hasLines={items.length > 0}
            canUpdate={ctx.permissions.has("orders.update")}
          />
          {after && (
            <AfterSale
              orderId={order.id}
              shipments={after.shipments}
              returns={after.returns}
              lines={after.lines.map((l) => ({ orderItemId: l.orderItemId, description: l.description, left: l.left, allowed: l.allowed, until: l.until }))}
              refunds={after.refunds}
              can={{ update: ctx.permissions.has("orders.update"), refund: ctx.permissions.has("orders.update") && (ctx.permissions.has("finance.create") || ctx.permissions.has("settings.manage")) }}
            />
          )}
          {supplierOrders.length > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-base">{t("dropship.panel.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <SupplierOrderList orders={supplierOrders} canManage={ctx.permissions.has("inventory.manage")} />
              </CardContent>
            </Card>
          )}
          </>
        )
      }
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
