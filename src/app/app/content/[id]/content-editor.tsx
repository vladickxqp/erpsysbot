"use client";

import { ArrowLeft, ExternalLink, ImagePlus, MessageSquare, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { PageHeader } from "@/components/app/page";
import { UploadButton } from "@/components/app/upload-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { intlTag } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { CONTENT_STATUSES, CONTENT_TYPES, PLATFORMS, type ContentStatus, type ContentType, type Platform } from "@/lib/content";
import { cn } from "@/lib/utils";
import { MediaThumb } from "../../media/media-view";
import { commentAction, deleteCommentAction, deleteContentAction, publishTelegramAction, saveContentAction } from "../actions";

/** How many characters each platform takes in the main text. */
const LIMITS: Partial<Record<Platform, number>> = { X: 280, INSTAGRAM: 2200, TIKTOK: 4000, LINKEDIN: 3000, YOUTUBE: 5000, TELEGRAM: 4096, FACEBOOK: 63206 };

type Form = {
  title: string;
  body: string;
  description: string;
  platform: string;
  contentType: string;
  status: string;
  category: string;
  hashtags: string;
  mediaIds: string[];
  date: string;
  time: string;
  assignedUserId: string | null;
};
type Comment = { id: string; body: string; mine: boolean; author: string; at: string };
type LibraryFile = { id: string; name: string; mimeType: string };

export function ContentEditor({
  id,
  initial,
  canManage,
  canPublish,
  canUpload,
  maxMediaBytes,
  me,
  members,
  targets,
  library,
  published,
  comments,
}: {
  id: string | null;
  initial: Form;
  canManage: boolean;
  canPublish: boolean;
  canUpload: boolean;
  maxMediaBytes: number;
  me: string;
  members: { id: string; name: string }[];
  targets: { id: string; name: string }[];
  library: LibraryFile[];
  published: { at: string; url: string | null; channel: string | null } | null;
  comments: Comment[];
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [comment, setComment] = useState("");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const readOnly = !canManage;
  const tag = intlTag(locale, region);
  const when = (iso: string) => new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const limit = LIMITS[form.platform as Platform];
  const length = form.body.length;
  const byId = new Map(library.map((f) => [f.id, f]));
  // Publishing is a button of its own; the status list offers it only to those allowed and only once.
  const statuses = CONTENT_STATUSES.filter((s) => s !== "PUBLISHED" || canPublish || initial.status === "PUBLISHED");

  const save = () =>
    start(async () => {
      const res = await saveContentAction(id, {
        title: form.title,
        body: form.body,
        description: form.description,
        platform: form.platform as Platform,
        contentType: form.contentType as ContentType,
        status: form.status as ContentStatus,
        category: form.category,
        hashtags: form.hashtags,
        mediaIds: form.mediaIds,
        date: form.date || null,
        time: form.time || null,
        assignedUserId: form.assignedUserId,
      });
      if (res.error) {
        toast.error(t(res.error));
        return;
      }
      toast.success(t("common.saved"));
      if (!id && res.id) router.replace(`/app/content/${res.id}`);
      else router.refresh();
    });

  const publish = () =>
    id &&
    start(async () => {
      const res = await publishTelegramAction(id, target);
      if (res.error) toast.error(t(res.error));
      else {
        toast.success(t("studio.publishedOk"));
        router.refresh();
      }
    });

  return (
    <>
      <PageHeader
        title={id ? form.title || t("studio.title") : t("studio.new")}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/app/content">
                <ArrowLeft className="size-4" /> {t("studio.title")}
              </Link>
            </Button>
            {id && canManage && (
              <Button variant="outline" onClick={() => setRemoving(true)}>
                <Trash2 className="size-4" /> {t("common.delete")}
              </Button>
            )}
            {canManage && (
              <Button onClick={save} disabled={pending || !form.title.trim()}>
                {t("common.save")}
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid h-fit gap-4 lg:col-span-2">
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <div className="grid gap-1.5">
                <Label htmlFor="c-title">{t("studio.titleLabel")}</Label>
                <Input id="c-title" value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={300} readOnly={readOnly} />
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="c-body">{t("studio.text")}</Label>
                  <span className={cn("text-xs tabular-nums text-muted-foreground", limit && length > limit && "text-destructive")}>
                    {limit ? `${length} / ${limit}` : length}
                  </span>
                </div>
                <Textarea id="c-body" rows={12} value={form.body} onChange={(e) => set("body", e.target.value)} readOnly={readOnly} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-desc">{t("studio.description")}</Label>
                <Textarea id="c-desc" rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} readOnly={readOnly} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="c-tags">{t("studio.hashtags")}</Label>
                  <Input id="c-tags" value={form.hashtags} onChange={(e) => set("hashtags", e.target.value)} placeholder="#" readOnly={readOnly} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-cat">{t("studio.category")}</Label>
                  <Input id="c-cat" value={form.category} onChange={(e) => set("category", e.target.value)} maxLength={80} readOnly={readOnly} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">{t("studio.media")}</CardTitle>
              {canManage && (
                <div className="flex gap-2">
                  {canUpload && <UploadButton variant="outline" media={{ maxBytes: maxMediaBytes }} label={t("documents.upload")} />}
                  <Button variant="outline" onClick={() => setPicking(true)}>
                    <ImagePlus className="size-4" /> {t("studio.fromLibrary")}
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {form.mediaIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("common.none")}</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {form.mediaIds.map((m) => {
                    const file = byId.get(m);
                    return (
                      <div key={m} className="relative overflow-hidden rounded-lg border">
                        {file ? <MediaThumb file={file} /> : <div className="aspect-video bg-muted" />}
                        <div className="truncate px-2 py-1 text-xs">{file?.name ?? "—"}</div>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => set("mediaIds", form.mediaIds.filter((x) => x !== m))}
                            className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-background/90 shadow"
                            aria-label={t("common.delete")}
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid h-fit gap-4">
          <Card>
            <CardContent className="grid gap-3 pt-6">
              <div className="grid gap-1.5">
                <Label>{t("studio.statusLabel")}</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)} disabled={readOnly}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statuses.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`studio.status.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>{t("studio.platformLabel")}</Label>
                  <Select value={form.platform} onValueChange={(v) => set("platform", v)} disabled={readOnly}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {t(`studio.platform.${p}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("studio.typeLabel")}</Label>
                  <Select value={form.contentType} onValueChange={(v) => set("contentType", v)} disabled={readOnly}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTENT_TYPES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {t(`studio.type.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="c-date">{t("studio.date")}</Label>
                  <Input id="c-date" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} readOnly={readOnly} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-time">{t("studio.time")}</Label>
                  <Input id="c-time" type="time" value={form.time} onChange={(e) => set("time", e.target.value)} readOnly={readOnly} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>{t("studio.assignee")}</Label>
                <Select value={form.assignedUserId ?? me} onValueChange={(v) => set("assignedUserId", v)} disabled={readOnly}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {id && (published || (canPublish && targets.length > 0)) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Send className="size-4" /> {t("studio.publish")}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {published ? (
                  <div className="grid gap-1">
                    <div>
                      {t("studio.publishedAt", { date: when(published.at) })}
                      {published.channel && ` · ${published.channel}`}
                    </div>
                    {published.url && (
                      <a href={published.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        <ExternalLink className="size-3.5" /> {published.url}
                      </a>
                    )}
                  </div>
                ) : (
                  <>
                    <Select value={target} onValueChange={setTarget}>
                      <SelectTrigger className="w-full" aria-label={t("studio.channel")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {targets.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            Telegram · {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={() => setConfirmPublish(true)} disabled={pending || !target}>
                      <Send className="size-4" /> {t("studio.publishNow")}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {id && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquare className="size-4" /> {t("studio.comments")}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {comments.map((c) => (
                  <div key={c.id} className="rounded-lg bg-muted/50 p-2.5 text-sm">
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{c.author}</span>
                      <span className="flex items-center gap-1">
                        {when(c.at)}
                        {c.mine && (
                          <button
                            type="button"
                            className="rounded p-0.5 hover:bg-muted"
                            aria-label={t("common.delete")}
                            onClick={() =>
                              start(async () => {
                                const res = await deleteCommentAction(id, c.id);
                                if (res.error) toast.error(t(res.error));
                                router.refresh();
                              })
                            }
                          >
                            <Trash2 className="size-3" />
                          </button>
                        )}
                      </span>
                    </div>
                    <p className="whitespace-pre-line">{c.body}</p>
                  </div>
                ))}
                <form
                  className="grid gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!comment.trim()) return;
                    start(async () => {
                      const res = await commentAction(id, comment);
                      if (res.error) toast.error(t(res.error));
                      else setComment("");
                      router.refresh();
                    });
                  }}
                >
                  <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("studio.commentPlaceholder")} aria-label={t("studio.comments")} />
                  <Button type="submit" size="sm" variant="outline" disabled={pending || !comment.trim()}>
                    {t("assistant.send")}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("studio.fromLibrary")}</DialogTitle>
          </DialogHeader>
          {library.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("media.empty")}</p>
          ) : (
            <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
              {library.map((f) => {
                const chosen = form.mediaIds.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => set("mediaIds", chosen ? form.mediaIds.filter((x) => x !== f.id) : [...form.mediaIds, f.id].slice(0, 20))}
                    className={cn("overflow-hidden rounded-lg border text-left", chosen && "ring-2 ring-primary")}
                    aria-pressed={chosen}
                  >
                    <MediaThumb file={f} />
                    <div className="truncate px-2 py-1 text-xs">{f.name}</div>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => setPicking(false)}>{t("common.save")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("common.delete")}
        text={form.title}
        confirm={t("common.delete")}
        destructive
        onConfirm={() =>
          id &&
          start(async () => {
            const res = await deleteContentAction(id);
            if (res.error) toast.error(t(res.error));
            else router.replace("/app/content");
          })
        }
      />
      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title={t("studio.publishNow")}
        text={t("studio.publishConfirm", { channel: targets.find((a) => a.id === target)?.name ?? "" })}
        confirm={t("studio.publishNow")}
        onConfirm={() => {
          setConfirmPublish(false);
          publish();
        }}
      />
    </>
  );
}
