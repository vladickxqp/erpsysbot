import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cn } from "@/lib/utils";
import { orderForBuyer } from "@/server/storefront";
import { shopOf, shopWords } from "../../store";
import { LOOK } from "../../ui";
import { WaitForPayment } from "./wait-for-payment";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const STEPS = ["RESERVED", "PICKING", "PACKED", "SHIPPED", "DELIVERED"] as const;

export default async function BuyerOrderPage({ params, searchParams }: { params: Promise<{ slug: string; token: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { slug, token } = await params;
  const store = await shopOf(slug);
  const order = await orderForBuyer(store, token);
  if (!order) notFound();
  const { t, money } = shopWords(store);
  const look = LOOK[store.design.template];
  const back = (await searchParams).paid === "1";
  const cancelled = order.fulfillment === "CANCELLED";
  const at = STEPS.indexOf(order.fulfillment as (typeof STEPS)[number]);
  const bank = order.method === "bank" && order.payment === "UNPAID" && !cancelled && store.company.iban;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{t("store.shop.orderTitle", { number: order.reference })}</h1>
        <p className="text-sm text-slate-600">{t("store.shop.thanks")}</p>
      </div>

      {back && order.payment === "UNPAID" && !cancelled && <WaitForPayment text={t("store.shop.confirmingPayment")} />}

      <div className={cn("grid gap-4 p-4", look.card, look.radius)}>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-slate-100 px-3 py-1">{t(`store.shop.status.${order.fulfillment}`)}</span>
          <span className={cn("rounded-full px-3 py-1", order.payment === "PAID" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100")}>{t(`store.shop.paid.${order.payment}`)}</span>
        </div>
        {!cancelled && (
          <ol className="grid grid-cols-5 gap-1" aria-label={t("store.shop.progress")}>
            {STEPS.map((s, i) => (
              <li key={s} className="grid gap-1" aria-current={i === at ? "step" : undefined}>
                <span className={cn("h-1.5 rounded-full bg-slate-200", i <= at && "bg-[var(--shop-accent)]")} />
                <span className={cn("truncate text-xs", i === at ? "font-medium" : "text-slate-500")}>{t(`store.shop.status.${s}`)}</span>
              </li>
            ))}
          </ol>
        )}
        {(order.carrier || order.trackingNumber) && (
          <p className="text-sm">
            {t("store.shop.tracking")}: {[order.carrier, order.trackingNumber].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {bank && (
        <div className={cn("grid gap-1 p-4 text-sm", look.card, look.radius)}>
          <h2 className="mb-1 font-semibold">{t("store.shop.bankTransfer")}</h2>
          <span>{store.company.legalName ?? store.company.name}</span>
          <span>
            {t("store.shop.iban")}: <span className="font-mono">{store.company.iban}</span>
          </span>
          {store.company.bic && <span>BIC: {store.company.bic}</span>}
          {store.company.bankName && <span>{store.company.bankName}</span>}
          <span>
            {t("store.shop.reference")}: <span className="font-mono">{order.reference}</span>
          </span>
          <span>
            {t("store.shop.amount")}: {money(order.grossCents)}
          </span>
        </div>
      )}

      <div className={cn("grid gap-3 p-4 text-sm", look.card, look.radius)}>
        <ul className="grid gap-1">
          {order.lines.map((l, i) => (
            <li key={i}>
              {l.quantity} × {l.description}
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
          <span>{t("store.shop.total")}</span>
          <span className="tabular-nums">{money(order.grossCents)}</span>
        </div>
        <div className="grid gap-0.5 text-slate-600">
          <span className="font-medium text-slate-900">{t("store.shop.shipTo")}</span>
          {order.shipTo.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
