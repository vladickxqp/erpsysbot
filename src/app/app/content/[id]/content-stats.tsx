"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { refreshStatsAction, saveContentLinkAction } from "../actions";

type Figures = { views: number | null; likes: number | null; comments: number | null };

/** What the platform reports for this piece, and a way to ask the assistant about it. */
export function ContentStats({ id, link, figures, video, canEdit, assistant }: { id: string; link: string | null; figures: Figures | null; video: boolean; canEdit: boolean; assistant: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState(link ?? "");
  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t("hub.stats.title")}</CardTitle>
        <div className="flex gap-2">
          {video && canEdit && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await refreshStatsAction(id);
                  if (result.error) toast.error(t(result.error));
                  router.refresh();
                })
              }
            >
              <RefreshCw className="size-4" /> {t("hub.stats.refresh")}
            </Button>
          )}
          {assistant && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/app/assistant?context=content:${id}`}>
                <Sparkles className="size-4" /> {t("hub.stats.analyse")}
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {!video && <p className="text-muted-foreground">{t("hub.stats.noVideo")}</p>}
        {canEdit && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const result = await saveContentLinkAction(id, url);
                if (result.error) toast.error(t(result.error));
                router.refresh();
              });
            }}
          >
            <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/…" aria-label={t("hub.stats.link")} />
            <Button type="submit" variant="outline" disabled={pending}>
              {t("common.save")}
            </Button>
          </form>
        )}
        {figures && (
          <div className="flex flex-wrap gap-6">
            {(["views", "likes", "comments"] as const).map((key) => (
              <div key={key}>
                <div className="text-xl font-semibold tabular-nums">{figures[key] ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{t(`hub.stats.${key}`)}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
