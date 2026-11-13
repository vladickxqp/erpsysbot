"use client";

import { Film, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { clock, FORMAT_NAMES, type VideoFormat, type VideoStatus } from "@/lib/video";
import { cn } from "@/lib/utils";
import { createVideoAction, deleteVideoAction, planVideoAction } from "./actions";

type Row = { id: string; title: string; format: VideoFormat; status: VideoStatus; seconds: number; scenes: number; color: string };

export const FORMAT_BOX: Record<VideoFormat, string> = { portrait: "aspect-[9/16]", landscape: "aspect-video", square: "aspect-square" };

export function VideosView({ videos, canManage, ai }: { videos: Row[]; canManage: boolean; ai: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [format, setFormat] = useState<VideoFormat>("portrait");
  const [removing, setRemoving] = useState<Row | null>(null);
  const [pending, start] = useTransition();

  const create = (withAi: boolean) =>
    start(async () => {
      const result = withAi ? await planVideoAction(name, format, 30) : await createVideoAction(name, format);
      if (result.ok && result.id) router.push(`/app/video/${result.id}`);
      else toast.error(t(result.error ?? "common.error"));
    });

  return (
    <div className="grid gap-6">
      {canManage && (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("video.format")}>
              {FORMAT_NAMES.map((f) => (
                <Button key={f} type="button" role="radio" aria-checked={format === f} variant={format === f ? "secondary" : "outline"} onClick={() => setFormat(f)}>
                  {t(`video.formats.${f}`)}
                </Button>
              ))}
            </div>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) create(false);
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("video.name")} aria-label={t("video.name")} maxLength={120} className="w-full sm:w-96" />
              <Button type="submit" variant={ai ? "outline" : "default"} disabled={pending || !name.trim()}>
                <Plus className="size-4" /> {t("video.new")}
              </Button>
              {ai && (
                <Button type="button" disabled={pending || name.trim().length < 3} onClick={() => create(true)}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {t("video.planAi")}
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      {videos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("video.empty")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {videos.map((v) => (
            <Card key={v.id} className="overflow-hidden pt-0">
              <Link href={`/app/video/${v.id}`} aria-label={v.title} className="grid h-40 place-items-center bg-muted/40 p-3">
                <span className={cn("grid h-full place-items-center rounded-md px-2 text-center text-[10px] font-bold text-white shadow", FORMAT_BOX[v.format])} style={{ backgroundColor: v.color }}>
                  <Film className="size-5 opacity-80" />
                </span>
              </Link>
              <CardContent className="grid gap-2">
                <div className="flex items-start justify-between gap-1">
                  <Link href={`/app/video/${v.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                    {v.title}
                  </Link>
                  {canManage && (
                    <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-destructive" aria-label={t("common.delete")} onClick={() => setRemoving(v)}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">{clock(v.seconds)}</span>
                  <Badge variant={v.status === "READY" ? "secondary" : "outline"} className={cn(v.status === "READY" && "border-success/20 bg-success/10 text-success", v.status === "FAILED" && "border-destructive/30 text-destructive")}>
                    {t(`video.status.${v.status}`)}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("video.deleteAsk")}
        text={removing?.title ?? ""}
        confirm={t("common.delete")}
        destructive
        onConfirm={() => {
          const v = removing;
          setRemoving(null);
          if (!v) return;
          start(async () => {
            const result = await deleteVideoAction(v.id);
            if (!result.ok) toast.error(t(result.error ?? "common.error"));
            router.refresh();
          });
        }}
      />
    </div>
  );
}
