"use client";

import { Download, FileText, Images, Music, MoreHorizontal, Trash2, Video } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SearchBox } from "@/components/app/list-controls";
import { EmptyState } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { deleteDocumentAction } from "../documents/actions";
import { fileSize } from "../documents/documents-view";
import { setCollectionAction } from "./actions";

export type MediaFile = { id: string; name: string; mimeType: string; sizeBytes: number; collection: string | null; createdAt: string };

const kindOf = (mime: string) => (mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "document");
export const fileUrl = (id: string) => `/app/documents/${id}/file`;

/** A small preview: the picture itself, a video's first frame, or an icon. */
export function MediaThumb({ file, className }: { file: Pick<MediaFile, "id" | "mimeType" | "name">; className?: string }) {
  const kind = kindOf(file.mimeType);
  const box = cn("grid aspect-video w-full place-items-center overflow-hidden bg-muted", className);
  if (kind === "image" && file.mimeType !== "image/heic") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={fileUrl(file.id)} alt={file.name} loading="lazy" className={cn(box, "object-cover")} />;
  }
  if (kind === "video") return <video src={`${fileUrl(file.id)}#t=0.5`} preload="metadata" muted className={cn(box, "object-cover")} />;
  const Icon = kind === "audio" ? Music : FileText;
  return (
    <div className={box}>
      <Icon className="size-8 text-muted-foreground" aria-hidden />
    </div>
  );
}

const FILTERS = [
  { key: "all", label: "common.all", params: {} },
  { key: "image", label: "media.images", params: { kind: "image" } },
  { key: "video", label: "media.videos", params: { kind: "video" } },
  { key: "document", label: "media.documents", params: { kind: "document" } },
  { key: "audio", label: "media.audio", params: { kind: "audio" } },
  { key: "THUMBNAIL", label: "media.thumbnails", params: { collection: "THUMBNAIL" } },
  { key: "BRAND", label: "media.brand", params: { collection: "BRAND" } },
] as const;

export function MediaView({ files, canManage }: { files: MediaFile[]; canManage: boolean }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState<MediaFile | null>(null);
  const [removing, setRemoving] = useState<MediaFile | null>(null);
  const [pending, start] = useTransition();
  const current = params.get("collection") ?? params.get("kind") ?? "all";

  const filter = (next: Record<string, string>) => {
    const q = new URLSearchParams();
    if (params.get("q")) q.set("q", params.get("q")!);
    for (const [k, v] of Object.entries(next)) q.set(k, v);
    start(() => router.replace(`${pathname}${q.size ? `?${q}` : ""}`));
  };
  const run = (work: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      const result = await work();
      if (result.error) toast.error(t(result.error));
      router.refresh();
    });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox placeholder={t("common.search")} />
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={current === f.key}
              size="sm"
              variant={current === f.key ? "default" : "outline"}
              className="rounded-full"
              onClick={() => filter(f.params)}
            >
              {t(f.label)}
            </Button>
          ))}
        </div>
      </div>

      {files.length === 0 ? (
        <EmptyState icon={Images} title={t("media.empty")} />
      ) : (
        <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5", pending && "opacity-60")}>
          {files.map((f) => (
            <div key={f.id} className="group overflow-hidden rounded-xl border bg-card shadow-xs">
              <button type="button" className="block w-full text-left" onClick={() => setOpen(f)} aria-label={f.name}>
                <MediaThumb file={f} />
              </button>
              <div className="flex items-start gap-1 p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" title={f.name}>
                    {f.name}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {kindOf(f.mimeType) === "video" && <Video className="size-3" aria-hidden />}
                    {fileSize(f.sizeBytes)} · {formatDate(f.createdAt, locale, region)}
                  </div>
                  {f.collection && <div className="mt-1 text-xs text-primary">{t(f.collection === "BRAND" ? "media.brand" : "media.thumbnails")}</div>}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={t("common.edit")}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem asChild>
                      <a href={`${fileUrl(f.id)}?download`}>
                        <Download className="size-4" /> {t("media.download")}
                      </a>
                    </DropdownMenuItem>
                    {canManage && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("media.collection")}</DropdownMenuLabel>
                        {[null, "THUMBNAIL", "BRAND"].map((c) => (
                          <DropdownMenuItem key={c ?? "none"} disabled={f.collection === c} onClick={() => run(() => setCollectionAction(f.id, c))}>
                            {c === null ? t("common.none") : t(c === "BRAND" ? "media.brand" : "media.thumbnails")}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => setRemoving(f)}>
                          <Trash2 className="size-4" /> {t("common.delete")}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{open?.name}</DialogTitle>
          </DialogHeader>
          {open && <MediaPreview file={open} />}
          {open && (
            <div className="flex justify-end">
              <Button asChild variant="outline">
                <a href={`${fileUrl(open.id)}?download`}>
                  <Download className="size-4" /> {t("media.download")}
                </a>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={t("common.delete")}
        text={removing?.name ?? ""}
        confirm={t("common.delete")}
        destructive
        onConfirm={() => {
          const file = removing;
          setRemoving(null);
          if (file) run(() => deleteDocumentAction(file.id));
        }}
      />
    </div>
  );
}

function MediaPreview({ file }: { file: MediaFile }) {
  const url = fileUrl(file.id);
  const kind = kindOf(file.mimeType);
  // eslint-disable-next-line @next/next/no-img-element
  if (kind === "image" && file.mimeType !== "image/heic") return <img src={url} alt={file.name} className="max-h-[70vh] w-full rounded-lg object-contain" />;
  if (kind === "video") return <video src={url} controls className="max-h-[70vh] w-full rounded-lg bg-black" />;
  if (kind === "audio") return <audio src={url} controls className="w-full" />;
  if (file.mimeType === "application/pdf") return <iframe src={url} title={file.name} className="h-[70vh] w-full rounded-lg border" />;
  return <MediaThumb file={file} className="rounded-lg" />;
}
