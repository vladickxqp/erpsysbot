import { Plus, Repeat } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/i18n";
import { getT } from "@/i18n/server";
import { listRecurring } from "@/server/recurring";
import { requirePageContext } from "@/server/request";
import { RecurringRowActions, RunNowButton } from "./recurring-actions";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("recurring.title") };
}

export default async function RecurringPage() {
  const ctx = await requirePageContext("invoices.read");
  const { t, locale, region } = await getT();
  const plans = await listRecurring(ctx);
  const canManage = ctx.permissions.has("invoices.create");
  return (
    <>
      <PageHeader
        title={t("recurring.title")}
        actions={
          canManage && (
            <>
              {plans.length > 0 && <RunNowButton />}
              <Button asChild>
                <Link href="/app/invoices/recurring/new">
                  <Plus className="size-4" /> {t("recurring.new")}
                </Link>
              </Button>
            </>
          )
        }
      />
      {plans.length === 0 ? (
        <EmptyState icon={Repeat} title={t("recurring.empty")} />
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {plans.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/app/invoices/recurring/${p.id}`} className="font-medium hover:text-primary hover:underline">
                  {p.clientName}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {p.title ? `${p.title} · ` : ""}
                  {t(`recurring.interval.${p.interval}`)}
                  {p.autoIssue && ` · ${t(p.autoSend ? "recurring.issuesAndSends" : "recurring.issues")}`}
                </div>
                {p.lastError && <div className="text-xs text-warning">{p.lastError}</div>}
              </div>
              <div className="text-right">
                <div className="tabular-nums">{formatMoney(p.grossCents, locale, region)}</div>
                <div className="text-xs text-muted-foreground">
                  {p.active ? t("recurring.next", { date: formatDate(p.nextDate, locale, region) }) : t("recurring.paused")}
                </div>
              </div>
              {canManage && <RecurringRowActions id={p.id} active={p.active} />}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
