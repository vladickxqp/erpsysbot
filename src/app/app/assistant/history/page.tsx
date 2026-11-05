import { ArrowLeft, History } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/i18n";
import { getT } from "@/i18n/server";
import { actionHistory } from "@/server/assistant/actions";
import { requirePageContext } from "@/server/request";
import { toolLabel } from "../tool-label";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("hub.ai.history") };
}

export default async function AssistantHistoryPage({ searchParams }: { searchParams: Promise<{ all?: string; reads?: string }> }) {
  const ctx = await requirePageContext("ai.use");
  const { t, locale, region } = await getT();
  const sp = await searchParams;
  const everyone = sp.all === "1" && ctx.permissions.has("ai.admin");
  const rows = await actionHistory(ctx, { everyone, includeReads: sp.reads === "1" });
  return (
    <>
      <PageHeader
        title={t("hub.ai.history")}
        actions={
          <>
            {ctx.permissions.has("ai.admin") && (
              <Button asChild variant="outline" size="sm">
                <Link href={everyone ? "/app/assistant/history" : "/app/assistant/history?all=1"}>{t(everyone ? "hub.ai.onlyMine" : "hub.ai.everyone")}</Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href={sp.reads === "1" ? "/app/assistant/history" : "/app/assistant/history?reads=1"}>{t(sp.reads === "1" ? "hub.ai.hideReads" : "hub.ai.showReads")}</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/assistant">
                <ArrowLeft className="size-4" /> {t("nav.ai")}
              </Link>
            </Button>
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={History} title={t("hub.ai.noHistory")} />
      ) : (
        <div className="divide-y rounded-xl border bg-card text-sm">
          {rows.map((r) => {
            const link = (r.result as { link?: unknown } | null)?.link;
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5">
                <span className="min-w-0 flex-1 font-medium">{toolLabel(t, r.tool)}</span>
                {everyone && <span className="text-xs text-muted-foreground">{r.who}</span>}
                {r.risk === "confirm" && <span className="text-xs text-muted-foreground">{t("hub.ai.needsConfirm")}</span>}
                <span className={r.status === "FAILED" ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>{t(`hub.ai.status_${r.status}`)}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{formatDate(r.createdAt.toISOString(), locale, region)}</span>
                {typeof link === "string" && link.startsWith("/app/") && (
                  <Link href={link} className="text-xs font-medium text-primary hover:underline">
                    {t("hub.ai.openResult")}
                  </Link>
                )}
                {r.error && <p className="w-full text-xs text-destructive">{r.error}</p>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
