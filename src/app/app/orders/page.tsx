import { ClipboardList, Plus } from "lucide-react";
import Link from "next/link";
import { OrderStatusBadge } from "@/components/app/badges";
import { FilterChips, Pager, SearchBox } from "@/components/app/list-controls";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/i18n";
import { getT } from "@/i18n/server";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/domain";
import { listOrders } from "@/server/orders";
import { requirePageContext } from "@/server/request";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("orders.title") };
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const ctx = await requirePageContext("orders.read");
  const { t, locale, region } = await getT();
  const sp = await searchParams;
  const status = sp.status === "OPEN" || (ORDER_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as OrderStatus | "OPEN") : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const { rows, total, pageSize } = await listOrders(ctx, { q: sp.q, status, page });
  const canCreate = ctx.permissions.has("orders.create");
  const filtered = Boolean(sp.q || sp.status);
  return (
    <>
      <PageHeader
        title={t("orders.title")}
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/app/orders/new">
                <Plus className="size-4" /> {t("orders.new")}
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 grid gap-3">
        <SearchBox placeholder={t("orders.searchPlaceholder")} />
        <FilterChips
          name="status"
          options={[
            { value: null, label: t("common.all") },
            { value: "OPEN", label: t("orders.open") },
            ...(["DRAFT", "COMPLETED", "CANCELLED"] as const).map((s) => ({ value: s, label: t(`orders.${s}`) })),
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={filtered ? t("orders.noMatch") : t("orders.emptyTitle")}
          action={
            !filtered && canCreate ? (
              <Button asChild>
                <Link href="/app/orders/new">
                  <Plus className="size-4" /> {t("orders.new")}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">{t("orders.number")}</TableHead>
                  <TableHead>{t("orders.client")}</TableHead>
                  <TableHead>{t("orders.orderTitle")}</TableHead>
                  <TableHead>{t("orders.status")}</TableHead>
                  <TableHead>{t("orders.dueDate")}</TableHead>
                  <TableHead className="text-right">{t("orders.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      <Link href={`/app/orders/${o.id}`} className="hover:underline">
                        {o.number}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/app/orders/${o.id}`} className="hover:underline">
                        {o.clientName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{o.title ?? "—"}</TableCell>
                    <TableCell>
                      <OrderStatusBadge status={o.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{o.dueDate ? formatDate(o.dueDate, locale, region) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(o.grossCents, locale, region)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid gap-2 md:hidden">
            {rows.map((o) => (
              <li key={o.id}>
                <Link href={`/app/orders/${o.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      #{o.number} · {o.clientName}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">{o.title ?? formatMoney(o.grossCents, locale, region)}</div>
                  </div>
                  <OrderStatusBadge status={o.status} />
                </Link>
              </li>
            ))}
          </ul>
          <Pager page={page} pages={Math.max(1, Math.ceil(total / pageSize))} label={t("orders.count", { count: total })} />
        </>
      )}
    </>
  );
}
