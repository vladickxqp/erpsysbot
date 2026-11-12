"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { SupplierFilter, SupplierOrderView } from "@/server/dropship";
import { SupplierOrderList } from "./supplier-orders";

const FILTERS: SupplierFilter[] = ["attention", "open", "all"];

export function DropshipQueue({ filter, orders, counts, canManage }: { filter: SupplierFilter; orders: SupplierOrderView[]; counts: { attention: number; open: number }; canManage: boolean }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">{t("dropship.queue")}</h2>
        <div className="flex rounded-lg border bg-card p-0.5">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={`/app/purchasing?tab=dropship${f === "attention" ? "" : `&filter=${f}`}`}
              className={cn("rounded-md px-3 py-1.5 text-sm", filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {t(`dropship.filter.${f}`)}
              {f !== "all" && <span className="ml-1.5 tabular-nums opacity-80">{f === "attention" ? counts.attention : counts.open}</span>}
            </Link>
          ))}
        </div>
      </div>
      <SupplierOrderList orders={orders} canManage={canManage} showOrder />
    </div>
  );
}
