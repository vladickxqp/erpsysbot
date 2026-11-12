import { ScrollText } from "lucide-react";
import Link from "next/link";
import { FilterChips, Pager } from "@/components/app/list-controls";
import { EmptyState, PageHeader } from "@/components/app/page";
import { intlTag } from "@/i18n";
import { getT } from "@/i18n/server";
import { ACTIVITY_ENTITIES, ACTIVITY_VERB, activityLink } from "@/lib/activity";
import { auditSummary, listAudit } from "@/server/audit-log";
import { requirePageContext } from "@/server/request";
import { memberOptions } from "@/server/team";
import { AuditFilters } from "./audit-filters";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("audit.title") };
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; entity?: string; user?: string; via?: string }> }) {
  const ctx = await requirePageContext("settings.manage");
  const { t, locale, region } = await getT();
  const sp = await searchParams;
  const log = await listAudit(ctx, { page: Number(sp.page) || 1, entity: sp.entity, userId: sp.user, via: sp.via });
  const members = await memberOptions(ctx);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const when = new Intl.DateTimeFormat(intlTag(locale, region), { dateStyle: "short", timeStyle: "medium", timeZone: ctx.organization.timezone });

  return (
    <>
      <PageHeader title={t("audit.title")} />
      <div className="mb-4 grid gap-3">
        <AuditFilters
          entities={ACTIVITY_ENTITIES.map((e) => ({ value: e, label: t(`activity.entity.${e}`) }))}
          members={members.map((m) => ({ value: m.id, label: m.name }))}
        />
        <FilterChips
          name="via"
          options={[
            { value: null, label: t("common.all") },
            { value: "web", label: "Web" },
            { value: "telegram", label: "Telegram" },
            { value: "ai", label: "AI" },
            { value: "shop", label: "Shop" },
            { value: "supplier", label: "API" },
          ]}
        />
      </div>
      {log.rows.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("widgets.noActivity")} />
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {log.rows.map((r) => {
            const [entity, verb] = r.action.split(".");
            const link = activityLink(r.action, r.entityId);
            const summary = auditSummary(r.data);
            const line = (
              <>
                <span className="font-medium">{t(`activity.entity.${entity}`)}</span>: {t(`activity.verb.${ACTIVITY_VERB[verb] ?? "changed"}`)}
                {summary && <span className="text-muted-foreground"> · {summary}</span>}
              </>
            );
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="w-40 shrink-0 text-xs tabular-nums text-muted-foreground">{when.format(r.createdAt)}</span>
                <span className="w-36 shrink-0 truncate">{(r.userId && names.get(r.userId)) || "—"}</span>
                <span className="min-w-0 flex-1 truncate">
                  {link ? (
                    <Link href={link} className="hover:text-primary hover:underline">
                      {line}
                    </Link>
                  ) : (
                    line
                  )}
                </span>
                {r.via !== "web" && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.via === "ai" ? "AI" : r.via === "shop" ? "Shop" : r.via === "supplier" ? "API" : "Telegram"}</span>}
              </div>
            );
          })}
        </div>
      )}
      <Pager page={log.page} pages={log.pages} label={t("audit.count", { count: String(log.total) })} />
    </>
  );
}
