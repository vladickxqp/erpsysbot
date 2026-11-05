"use client";

import { ArrowRight, Lightbulb, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { dismissAction } from "@/app/app/inbox/actions";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { Insight } from "@/server/insights";

const TONE = ["border-border", "border-warning/50", "border-destructive/50"];

/** One insight: what it is, why it is shown, the records behind it, the next step. */
export function InsightCard({ insight, compact }: { insight: Insight; compact?: boolean }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const Icon = insight.importance === 2 ? TriangleAlert : Lightbulb;
  return (
    <article className={cn("rounded-xl border bg-card p-3 text-sm", TONE[insight.importance])}>
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 size-4 shrink-0", insight.importance === 2 ? "text-destructive" : "text-primary")} aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{t(`hub.i.${insight.key}.title`, insight.vars)}</h3>
          <p className="text-xs text-muted-foreground">{t(`hub.i.${insight.key}.why`, insight.vars)}</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          disabled={pending}
          aria-label={t("hub.inbox.dismiss")}
          onClick={() =>
            start(async () => {
              await dismissAction(`insight:${insight.key}`, insight.fingerprint);
              router.refresh();
            })
          }
        >
          <X className="size-4" />
        </Button>
      </div>
      {!compact && insight.items.length > 0 && (
        <ul className="mt-2 grid gap-1 pl-6.5">
          {insight.items.map((item) => (
            <li key={item.href + item.label}>
              <Link href={item.href} className="flex items-baseline gap-2 hover:text-primary">
                <span className="min-w-0 truncate">{item.label}</span>
                {item.hint && <span className="truncate text-xs text-muted-foreground">{item.hint}</span>}
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                  {item.date ? formatDate(item.date, locale, region) : ""}
                  {item.date && item.amountCents !== undefined ? " · " : ""}
                  {item.amountCents !== undefined ? formatMoney(item.amountCents, locale, region) : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href={insight.href} className="mt-2 ml-6.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        {t(`hub.i.${insight.key}.action`, insight.vars)} <ArrowRight className="size-3" aria-hidden />
      </Link>
    </article>
  );
}
