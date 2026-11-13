import Link from "next/link";
import { PageHeader } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/i18n";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { requirePageContext } from "@/server/request";
import { listReturns, returnCounts, type ReturnFilter } from "@/server/returns";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("aftersales.title") };
}

const FILTERS: ReturnFilter[] = ["open", "refund", "closed", "all"];

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await requirePageContext("orders.read");
  const { t, locale } = await getT();
  const asked = (await searchParams).filter;
  const filter: ReturnFilter = FILTERS.includes(asked as ReturnFilter) ? (asked as ReturnFilter) : "open";
  const [rows, counts] = await Promise.all([listReturns(ctx, filter), returnCounts(ctx)]);
  const money = (c: number) => formatMoney(c, locale, { country: ctx.organization.country, currency: ctx.organization.currency });
  return (
    <>
      <PageHeader title={t("aftersales.title")} />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("aftersales.title")}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/app/returns?filter=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-sm hover:bg-accent", f === filter && "border-primary bg-primary/10 font-medium")}
          >
            {t(`aftersales.filter.${f}`)}
            {f === "open" && counts.open > 0 && ` · ${counts.open}`}
            {f === "refund" && counts.refund > 0 && ` · ${counts.refund}`}
          </Link>
        ))}
      </nav>
      <Card>
        <CardContent className="pt-6">
          {!rows.length ? (
            <p className="text-sm text-muted-foreground">{t("aftersales.empty")}</p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/app/returns/${r.id}`} className="grid gap-1 py-3 text-sm hover:bg-accent/50 sm:grid-cols-[120px_1fr_auto_auto] sm:items-center sm:gap-4">
                    <span className="font-medium">{t("aftersales.number", { number: r.number })}</span>
                    <span className="min-w-0 truncate">
                      {r.client} · {t("aftersales.order")} {r.orderNumber} · {t(`aftersales.reason.${r.reason}`)}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{money(r.refundCents)}</span>
                    <Badge variant="outline" className="w-fit">
                      {t(`aftersales.status.${r.status}`)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
