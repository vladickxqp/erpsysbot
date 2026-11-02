"use client";

import { ExternalLink, RefreshCw, Share2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/page";
import { TrendChart } from "@/components/app/trend-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { intlTag } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { ChannelOverview } from "@/server/social";
import { refreshSocialAction } from "./actions";

export function Delta({ value }: { value: number | null }) {
  const { locale, region } = useI18n();
  if (value === null || value === 0) return null;
  return (
    <span className={cn("text-xs tabular-nums", value > 0 ? "text-success" : "text-destructive")}>
      {value > 0 ? "+" : "−"}
      {new Intl.NumberFormat(intlTag(locale, region)).format(Math.abs(value))}
    </span>
  );
}

export function SocialView({ channels, canConnect }: { channels: ChannelOverview[]; canConnect: boolean }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const tag = intlTag(locale, region);
  const nf = new Intl.NumberFormat(tag);
  const num = (v: number | null) => (v === null ? "—" : nf.format(v));

  if (!channels.length) {
    return (
      <EmptyState
        icon={Share2}
        title={t("social.empty")}
        action={
          <div className="grid max-w-md justify-items-center gap-3">
            <p className="text-sm text-muted-foreground">{t("social.emptyHow")}</p>
            {canConnect && (
              <Button asChild>
                <Link href="/app/integrations">{t("integrations.title")}</Link>
              </Button>
            )}
          </div>
        }
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex justify-end gap-2">
        {canConnect && (
          <Button asChild variant="outline">
            <Link href="/app/integrations">{t("integrations.title")}</Link>
          </Button>
        )}
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await refreshSocialAction();
              if (res.error) toast.error(t(res.error));
              else if (res.failed) toast.error(t("social.someFailed", { count: String(res.failed) }));
              router.refresh();
            })
          }
        >
          <RefreshCw className={cn("size-4", pending && "animate-spin")} /> {t("social.refresh")}
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {channels.map((c) => (
          <Card key={c.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span className="min-w-0 truncate">{c.name}</span>
                {c.url && (
                  <a href={c.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={c.name}>
                    <ExternalLink className="size-4" />
                  </a>
                )}
              </CardTitle>
              <div className="text-xs text-muted-foreground">{t(`social.provider.${c.provider}`)}</div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">{t("social.followers")}</div>
                  <div className="text-lg font-semibold tabular-nums">{num(c.followers)}</div>
                  <Delta value={c.followersDelta} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("social.views")}</div>
                  <div className="text-lg font-semibold tabular-nums">{num(c.views)}</div>
                  <Delta value={c.viewsDelta} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("social.posts")}</div>
                  <div className="text-lg font-semibold tabular-nums">{num(c.posts)}</div>
                </div>
              </div>
              <TrendChart data={c.history.map((h) => ({ day: h.day, value: h.followers }))} />
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {c.lastError && <TriangleAlert className="size-3.5 text-warning" aria-label={t(`social.${c.lastError}`)} />}
                {c.lastFetchedAt && t("social.updated", { date: new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" }).format(new Date(c.lastFetchedAt)) })}
                {c.lastError && ` · ${t(`social.${c.lastError}`)}`}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
