import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import type { ReturnStatus, SupplierReturnStatus } from "@/lib/returns";
import { NotFoundError } from "@/server/clients";
import { refundsOf } from "@/server/refunds";
import { requirePageContext } from "@/server/request";
import { getReturn } from "@/server/returns";
import { ReturnDetail } from "./return-detail";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("orders.read");
  const { t } = await getT();
  const found = await getReturn(ctx, (await params).id).catch(() => null);
  return { title: found ? t("aftersales.number", { number: found.ret.number }) : t("aftersales.title") };
}

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("orders.read");
  const { id } = await params;
  const found = await getReturn(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const money = await refundsOf(ctx, found.order.id);
  const { ret, order } = found;
  return (
    <ReturnDetail
      ret={{
        id: ret.id,
        number: ret.number,
        status: ret.status as ReturnStatus,
        reason: ret.reason,
        resolution: ret.resolution,
        description: ret.description,
        note: ret.note,
        channel: ret.channel,
        refundCents: ret.refundCents,
        photoIds: ret.photoIds,
        createdAt: ret.createdAt.toISOString(),
      }}
      order={{ id: order.id, number: order.number, grossCents: order.grossCents, paymentStatus: order.paymentStatus }}
      client={found.client}
      items={found.items.map((i) => ({ id: i.id, description: i.description, quantity: Number(i.quantity), condition: i.condition, restocked: Number(i.restocked) }))}
      events={found.events.map((e) => ({ id: e.id, kind: e.kind, at: e.createdAt.toISOString(), note: ((e.data ?? {}) as { note?: string }).note ?? null }))}
      supplierReturns={found.supplierReturns.map(({ s, name, conditions, number }) => ({
        id: s.id,
        supplier: name,
        conditions,
        supplierOrder: number,
        status: s.status as SupplierReturnStatus,
        expectedCents: s.expectedCents,
        settledCents: s.settledCents,
        currency: s.currency,
        reference: s.reference,
      }))}
      canSupplierReturn={found.canSupplierReturn}
      refunds={money}
      can={{ update: ctx.permissions.has("orders.update"), refund: ctx.permissions.has("orders.update") && (ctx.permissions.has("finance.create") || ctx.permissions.has("settings.manage")) }}
    />
  );
}
