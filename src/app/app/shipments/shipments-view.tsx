"use client";

import { AlertTriangle, MapPin, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { EmptyState, StatCard } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { MapFilter, MapParcel } from "@/server/geo";
import { colorOf, ShipmentMap } from "./shipment-map";

const FILTERS: MapFilter[] = ["open", "recent"];

export function ShipmentsView({ parcels, filter }: { parcels: MapParcel[]; filter: MapFilter }) {
  const { t, locale, region } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const carrier = (p: MapParcel) => (p.carrier === "other" ? (p.carrierName ?? t("aftersales.carrier.other")) : t(`aftersales.carrier.${p.carrier}`));
  const when = (iso: string | null) => (iso ? formatDate(iso, locale, region) : "—");
  const label = useCallback(
    (p: MapParcel) => ({
      title: `${t("tracking.order")} ${p.number}`,
      lines: [p.client, `${carrier(p)}${p.trackingNumber ? ` · ${p.trackingNumber}` : ""}`, t(`aftersales.shipment.${p.status}`), p.place ?? ""].filter(Boolean),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );
  const onMap = parcels.filter((p) => p.lat !== null).length;
  const problems = parcels.filter((p) => colorOf(p) === "#dc2626").length;

  return (
    <div className="grid gap-4">
      <nav className="flex flex-wrap gap-2" aria-label={t("tracking.title")}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "open" ? "/app/shipments" : `/app/shipments?filter=${f}`}
            className={cn("rounded-full border px-3 py-1 text-sm", f === filter ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            aria-current={f === filter ? "page" : undefined}
          >
            {t(`tracking.${f}`)}
          </Link>
        ))}
      </nav>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("tracking.parcels")} value={String(parcels.length)} icon={Truck} />
        <StatCard label={t("tracking.onMap")} value={String(onMap)} icon={MapPin} />
        <StatCard label={t("tracking.problems")} value={String(problems)} icon={AlertTriangle} />
      </div>
      <ShipmentMap parcels={parcels} selected={selected} label={label} onSelect={setSelected} />
      {parcels.length === 0 ? (
        <EmptyState icon={Truck} title={t("tracking.none")} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t("tracking.order")}</th>
                  <th className="px-4 py-2 font-medium">{t("tracking.client")}</th>
                  <th className="px-4 py-2 font-medium">{t("aftersales.shipping.carrier")}</th>
                  <th className="px-4 py-2 font-medium">{t("aftersales.shipping.tracking")}</th>
                  <th className="px-4 py-2 font-medium">{t("tracking.status")}</th>
                  <th className="px-4 py-2 font-medium">{t("aftersales.shipping.location")}</th>
                  <th className="px-4 py-2 font-medium">{t("tracking.last")}</th>
                </tr>
              </thead>
              <tbody>
                {parcels.map((p) => (
                  <tr key={p.id} className={cn("border-b last:border-0", selected === p.id && "bg-muted/60")}>
                    <td className="px-4 py-2">
                      <Link href={`/app/orders/${p.orderId}`} className="font-medium hover:underline">
                        {p.number}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{p.client}</td>
                    <td className="px-4 py-2">{carrier(p)}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {p.trackingNumber ? (
                        p.trackingUrl ? (
                          <a href={p.trackingUrl} target="_blank" rel="noreferrer" className="hover:underline">
                            {p.trackingNumber}
                          </a>
                        ) : (
                          p.trackingNumber
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorOf(p) }} aria-hidden />
                        {t(`aftersales.shipment.${p.status}`)}
                        {p.problem && <Badge variant="destructive">{t(`aftersales.problem.${p.problem}`)}</Badge>}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {p.lat !== null ? (
                        <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => setSelected(p.id)}>
                          <MapPin className="size-3.5" aria-hidden />
                          {p.place}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">{p.place ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{when(p.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
