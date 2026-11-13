"use client";

import { ArrowLeft, Copy, Download, Film, GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { UploadButton } from "@/components/app/upload-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import {
  clock,
  FORMAT_NAMES,
  MAX_SCENE_SECONDS,
  MAX_SCENE_TEXT,
  MAX_SCENES,
  MAX_VIDEO_SECONDS,
  MIN_SCENE_SECONDS,
  SCENE_EFFECTS,
  TEXT_POSITIONS,
  totalSeconds,
  TRANSITIONS,
  type Scene,
  type Transition,
  type VideoFormat,
  type VideoStatus,
} from "@/lib/video";
import { cn } from "@/lib/utils";
import { ColorField, DropLine, Field, newId, RangeField, Segmented, useDragSort } from "../../store/[id]/editor-ui";
import { renderVideoAction, saveVideoAction, videoStatusAction } from "../actions";
import { FORMAT_BOX } from "../videos-view";

type Media = { id: string; name: string; mimeType: string };
type EditorVideo = {
  id: string;
  title: string;
  format: VideoFormat;
  transition: Transition;
  color: string;
  scenes: Scene[];
  musicId: string | null;
  musicVolume: number;
  voiceId: string | null;
  status: VideoStatus;
  progress: number;
  outputId: string | null;
  error: string | null;
};

const fileOf = (id: string, download = false) => `/app/documents/${id}/file${download ? "?download" : ""}`;
const isClip = (m: Media | undefined) => !!m && m.mimeType.startsWith("video/");

/** A scene as it will look: its picture, clip or card, with the text where it goes. */
function Frame({ scene, media, color, format, className }: { scene: Scene; media: Media | undefined; color: string; format: VideoFormat; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-black", FORMAT_BOX[format], className)} style={media ? undefined : { backgroundColor: color }}>
      {media &&
        (isClip(media) ? (
          <video src={fileOf(media.id)} muted playsInline preload="metadata" className="absolute inset-0 size-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileOf(media.id)} alt="" className="absolute inset-0 size-full object-cover" />
        ))}
      {scene.text && (
        <div className={cn("absolute inset-x-[6%] flex justify-center", scene.position === "top" ? "top-[10%]" : scene.position === "center" ? "top-1/2 -translate-y-1/2" : "bottom-[12%]")}>
          <span className="whitespace-pre-line rounded-sm bg-black/50 px-[0.6em] py-[0.35em] text-center text-[0.9em] font-bold leading-snug text-white">{scene.text}</span>
        </div>
      )}
    </div>
  );
}

export function VideoEditor({
  video,
  pictures,
  sounds,
  canManage,
  canUpload,
  canRender,
  maxUpload,
}: {
  video: EditorVideo;
  pictures: Media[];
  sounds: Media[];
  canManage: boolean;
  canUpload: boolean;
  canRender: boolean;
  maxUpload: number;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [v, setV] = useState({ title: video.title, format: video.format, transition: video.transition, color: video.color, scenes: video.scenes, musicId: video.musicId, musicVolume: video.musicVolume, voiceId: video.voiceId });
  const [chosen, setChosen] = useState<string | null>(video.scenes[0]?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(video.status);
  const [progress, setProgress] = useState(video.progress);
  const [outputId, setOutputId] = useState(video.outputId);
  const [pending, start] = useTransition();
  const mediaOf = (id: string | null) => pictures.find((p) => p.id === id);
  const total = totalSeconds(v.scenes);
  const tooLong = total > MAX_VIDEO_SECONDS;
  const current = v.scenes.find((s) => s.id === chosen) ?? v.scenes[0];

  const set = (patch: Partial<typeof v>) => {
    setV((old) => ({ ...old, ...patch }));
    setDirty(true);
  };
  const setScene = (id: string, patch: Partial<Scene>) => set({ scenes: v.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const move = (from: number, to: number) => {
    const next = [...v.scenes];
    const [scene] = next.splice(from, 1);
    next.splice(to, 0, scene);
    set({ scenes: next });
  };
  const sort = useDragSort(move);
  const addScene = () => {
    const scene: Scene = { id: newId(), mediaId: null, seconds: 3, text: "", position: "bottom", effect: "none", sound: true };
    set({ scenes: [...v.scenes, scene] });
    setChosen(scene.id);
  };

  const save = () =>
    start(async () => {
      const result = await saveVideoAction(video.id, v);
      if (!result.ok) return void toast.error(t(result.error ?? "common.error"));
      toast.success(t("common.saved"));
      setDirty(false);
      if (status !== "RENDERING") setStatus("DRAFT");
      router.refresh();
    });
  const render = () =>
    start(async () => {
      const result = await renderVideoAction(video.id, v);
      if (!result.ok) return void toast.error(t(result.error ?? "common.error"));
      setDirty(false);
      setProgress(0);
      setStatus("RENDERING");
    });

  // While a render runs, the page asks how far it is.
  useEffect(() => {
    if (status !== "RENDERING") return;
    const timer = setInterval(async () => {
      const result = await videoStatusAction(video.id);
      if (!result.ok || !result.status) return;
      setProgress(result.progress ?? 0);
      if (result.status === "RENDERING") return;
      setStatus(result.status);
      setOutputId(result.outputId ?? null);
      if (result.status === "READY") toast.success(t("video.ready"));
      else toast.error(t("video.failed"));
      router.refresh();
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, video.id]);

  const rendering = status === "RENDERING";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" asChild aria-label={t("video.title")}>
          <Link href="/app/video">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <Input value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} aria-label={t("video.name")} className="h-10 min-w-48 flex-1 text-lg font-semibold sm:max-w-md" disabled={!canManage} />
        <Badge variant="outline" className={cn(status === "READY" && "border-success/20 bg-success/10 text-success", status === "FAILED" && "border-destructive/30 text-destructive")}>
          {t(`video.status.${status}`)}
        </Badge>
        <span className={cn("ml-auto text-sm tabular-nums text-muted-foreground", tooLong && "font-semibold text-destructive")}>
          {clock(total)} / {clock(MAX_VIDEO_SECONDS)}
        </span>
        {canUpload && <UploadButton variant="outline" media={{ maxBytes: maxUpload }} />}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className={cn("grid min-w-0 content-start gap-3", sort.dragging && "select-none")}>
          {v.scenes.map((s, i) => {
            const media = mediaOf(s.mediaId);
            const drag = sort.item(i);
            return (
              <Fragment key={s.id}>
                {sort.lineBefore === i && <DropLine />}
                <Card
                  ref={drag.ref}
                  style={drag.style}
                  data-scene=""
                  onClick={() => setChosen(s.id)}
                  className={cn("gap-0 py-0", current?.id === s.id && "ring-2 ring-primary/30", drag["data-dragging"] !== undefined && "shadow-2xl ring-2 ring-primary/40")}
                >
                  <CardContent className="grid gap-3 p-3 sm:grid-cols-[auto_5rem_minmax(0,1fr)]">
                    <div className="flex items-start gap-1 sm:flex-col">
                      <button
                        type="button"
                        aria-label={t("look.drag")}
                        title={t("look.drag")}
                        className="grid size-8 cursor-grab place-items-center rounded-md text-muted-foreground hover:bg-accent active:cursor-grabbing"
                        disabled={!canManage}
                        {...sort.handle(i)}
                      >
                        <GripVertical className="size-4" />
                      </button>
                      <span className="grid size-8 place-items-center text-xs font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                    </div>
                    <Frame scene={{ ...s, text: "" }} media={media} color={v.color} format={v.format} className="w-20 self-start" />
                    <div className="grid min-w-0 gap-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label={t("video.media")} className="min-w-40 flex-1">
                          <Select value={media ? media.id : "none"} onValueChange={(id) => setScene(s.id, { mediaId: id === "none" ? null : id })} disabled={!canManage}>
                            <SelectTrigger className="w-full" aria-label={t("video.media")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{t("video.noMedia")}</SelectItem>
                              {pictures.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label={t("video.seconds")} className="w-24">
                          <Input
                            type="number"
                            min={MIN_SCENE_SECONDS}
                            max={MAX_SCENE_SECONDS}
                            step={0.5}
                            value={s.seconds}
                            onChange={(e) => setScene(s.id, { seconds: Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, Number(e.target.value) || MIN_SCENE_SECONDS)) })}
                            disabled={!canManage}
                          />
                        </Field>
                        <div className="flex">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("sites.duplicate")}
                            disabled={!canManage || v.scenes.length >= MAX_SCENES}
                            onClick={() => set({ scenes: [...v.scenes.slice(0, i + 1), { ...s, id: newId() }, ...v.scenes.slice(i + 1)] })}
                          >
                            <Copy className="size-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" aria-label={t("common.delete")} disabled={!canManage || v.scenes.length <= 1} onClick={() => set({ scenes: v.scenes.filter((x) => x.id !== s.id) })}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                      <Field label={t("video.text")}>
                        <Textarea rows={2} value={s.text} onChange={(e) => setScene(s.id, { text: e.target.value })} maxLength={MAX_SCENE_TEXT} disabled={!canManage} />
                      </Field>
                      {s.note && <p className="text-xs italic text-muted-foreground">{s.note}</p>}
                      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                        <Segmented label={t("video.position")} value={s.position} options={TEXT_POSITIONS} words="video.positions" onChange={(position) => position && setScene(s.id, { position })} />
                        {media && !isClip(media) && <Segmented label={t("video.effect")} value={s.effect} options={SCENE_EFFECTS} words="video.effects" onChange={(effect) => effect && setScene(s.id, { effect })} />}
                        {isClip(media) && (
                          <label className="flex h-8 items-center gap-2 text-sm">
                            <Checkbox checked={s.sound} onCheckedChange={(c) => setScene(s.id, { sound: c === true })} /> {t("video.sound")}
                          </label>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Fragment>
            );
          })}
          {sort.lineBefore === v.scenes.length && <DropLine />}
          {canManage && (
            <div>
              <Button type="button" variant="outline" disabled={v.scenes.length >= MAX_SCENES} onClick={addScene}>
                <Plus className="size-4" /> {t("video.addScene")}
              </Button>
            </div>
          )}
        </div>

        <div className="grid min-w-0 content-start gap-4 xl:sticky xl:top-4 xl:self-start">
          {current && (
            <div className="grid justify-items-center rounded-xl border bg-muted/40 p-4 text-[11px]">
              <Frame scene={current} media={mediaOf(current.mediaId)} color={v.color} format={v.format} className={v.format === "landscape" ? "w-full" : "h-72"} />
            </div>
          )}
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <Segmented label={t("video.format")} value={v.format} options={FORMAT_NAMES} words="video.formats" onChange={(format) => format && set({ format })} />
              <Segmented label={t("video.transition")} value={v.transition} options={TRANSITIONS} words="video.transitions" onChange={(transition) => transition && set({ transition })} />
              <ColorField label={t("video.color")} value={v.color} onChange={(color) => set({ color })} />
              <Field label={t("video.music")}>
                <Select value={v.musicId && sounds.some((m) => m.id === v.musicId) ? v.musicId : "none"} onValueChange={(id) => set({ musicId: id === "none" ? null : id })} disabled={!canManage}>
                  <SelectTrigger className="w-full" aria-label={t("video.music")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("video.noSound")}</SelectItem>
                    {sounds.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {v.musicId && <RangeField label={t("video.volume")} value={v.musicVolume} min={0} max={100} step={5} format={(n) => `${n} %`} onChange={(musicVolume) => set({ musicVolume })} />}
              <Field label={t("video.voice")}>
                <Select value={v.voiceId && sounds.some((m) => m.id === v.voiceId) ? v.voiceId : "none"} onValueChange={(id) => set({ voiceId: id === "none" ? null : id })} disabled={!canManage}>
                  <SelectTrigger className="w-full" aria-label={t("video.voice")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("video.noSound")}</SelectItem>
                    {sounds.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>

          {canManage && (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" disabled={pending || rendering || tooLong || !v.title.trim()} onClick={save}>
                  {t("common.save")}
                </Button>
                <Button type="button" disabled={pending || rendering || tooLong || !canRender || !v.title.trim()} onClick={render}>
                  {rendering ? <Loader2 className="size-4 animate-spin" /> : <Film className="size-4" />} {t("video.render")}
                </Button>
                {dirty && !rendering && <Badge variant="outline">{t("sites.unsaved")}</Badge>}
                {!canRender && <Badge variant="outline">{t("video.error.NOT_CONFIGURED")}</Badge>}
              </div>
              {rendering && (
                <div className="grid gap-1" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={t("video.rendering")}>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${Math.max(3, progress)}%` }} />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t("video.rendering")} {progress} %
                  </span>
                </div>
              )}
            </div>
          )}

          {outputId && !rendering && (
            <div className="grid gap-2">
              <span className="text-sm font-medium">{t(status === "READY" ? "video.status.READY" : "video.lastRender")}</span>
              <video key={outputId} controls playsInline preload="metadata" src={fileOf(outputId)} className={cn("w-full rounded-lg bg-black", v.format === "portrait" && "max-h-[28rem]")} />
              <Button variant="outline" size="sm" asChild className="justify-self-start">
                <a href={fileOf(outputId, true)}>
                  <Download className="size-4" /> {t("video.download")}
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
