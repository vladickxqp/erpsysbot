"use client";

import { ExternalLink, Loader2, Monitor, RotateCcw, Smartphone, Tablet, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { StoreResult } from "../actions";

/** Runs a save, says how it went and reloads the page's data. */
export function useSave() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (work: () => Promise<StoreResult>, then?: (r: StoreResult) => void) =>
    start(async () => {
      const result = await work();
      if (result.ok) {
        if (then) then(result);
        else toast.success(t("common.saved"));
        router.refresh();
      } else toast.error([t(result.error ?? "common.error"), ...(result.failed ?? []).map((c) => t(`store.check.${c}`))].join(" · "));
    });
  return { pending, run };
}

export function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export const thumb = (id: string) => `/app/documents/${id}/file`;
export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `b${Date.now()}${Math.random().toString(36).slice(2)}`);

export type Images = { id: string; name: string }[];

const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** A picture from the company's images, or a new one uploaded here (button or drop) and chosen at once. */
export function ImagePick({ value, onChange, images, label, small }: { value: string | null | undefined; onChange: (id: string | null) => void; images: Images; label: string; small?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Images>([]);
  const all = [...added.filter((a) => !images.some((i) => i.id === a.id)), ...images];

  const upload = async (file: File) => {
    if (!IMAGE_TYPES.test(file.type)) return void toast.error(t("documents.TYPE"));
    if (file.size > MAX_IMAGE_BYTES) return void toast.error(t("documents.TOO_LARGE"));
    const form = new FormData();
    form.append("file", file);
    form.append("category", "Website");
    setBusy(true);
    try {
      const res = await fetch("/app/documents/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; ids?: string[]; error?: string };
      const id = body.ok ? body.ids?.[0] : undefined;
      if (!id) return void toast.error(t(`documents.${body.error ?? "TYPE"}`));
      setAdded((list) => [{ id, name: file.name }, ...list]);
      onChange(id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex min-w-0 items-center gap-2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) void upload(file);
      }}
    >
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb(value)} alt="" className={cn("shrink-0 rounded-md border object-cover", small ? "size-10" : "size-14")} />
      ) : (
        <div className={cn("shrink-0 rounded-md border bg-muted", small ? "size-10" : "size-14")} />
      )}
      <Select value={value ?? "none"} onValueChange={(id) => onChange(id === "none" ? null : id)}>
        <SelectTrigger className="w-full min-w-0" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t("store.noImage")}</SelectItem>
          {all.map((img) => (
            <SelectItem key={img.id} value={img.id}>
              {img.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label={t("documents.upload")} title={t("documents.upload")} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
      </Button>
    </div>
  );
}

const DEVICES = [
  { key: "desktop", width: 1280, icon: Monitor },
  { key: "tablet", width: 768, icon: Tablet },
  { key: "mobile", width: 390, icon: Smartphone },
] as const;

/**
 * The site as visitors see it (the company sees its draft), at the real
 * width of the chosen device and scaled down to fit; `version` reloads it
 * after a save.
 */
export function Preview({ src, version = 0, className }: { src: string; version?: number; className?: string }) {
  const { t } = useI18n();
  const [device, setDevice] = useState<(typeof DEVICES)[number]["key"]>("desktop");
  const [reload, setReload] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const width = DEVICES.find((d) => d.key === device)!.width;
  const scale = boxWidth ? Math.min(1, boxWidth / width) : 1;
  return (
    <div className={cn("grid overflow-hidden rounded-xl border bg-card", className)}>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-sm font-medium">{t("store.preview")}</span>
        <div className="flex items-center gap-1">
          <div className="flex gap-1" role="radiogroup" aria-label={t("store.preview")}>
            {DEVICES.map((d) => (
              <Button key={d.key} type="button" variant={device === d.key ? "secondary" : "ghost"} size="icon" role="radio" aria-checked={device === d.key} aria-label={t(`store.device.${d.key}`)} onClick={() => setDevice(d.key)}>
                <d.icon className="size-4" />
              </Button>
            ))}
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label={t("sites.reload")} onClick={() => setReload((n) => n + 1)}>
            <RotateCcw className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={t("sites.openPage")} asChild>
            <a href={src} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
            </a>
          </Button>
        </div>
      </div>
      <div ref={box} className="relative h-[72vh] overflow-hidden bg-muted/40">
        <iframe
          key={`${device}-${version}-${reload}`}
          title={t("store.preview")}
          src={src}
          className="absolute top-0 border-0 bg-white"
          style={{
            width,
            height: `calc(72vh / ${scale})`,
            left: Math.max(0, (boxWidth - width * scale) / 2),
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        />
      </div>
    </div>
  );
}
