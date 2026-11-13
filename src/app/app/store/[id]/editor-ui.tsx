"use client";

import { ExternalLink, Loader2, Monitor, RotateCcw, Smartphone, Tablet, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** A colour as a picker and as #rrggbb; only whole colours are passed on. */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" value={HEX_COLOR.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded border" aria-label={label} />
        <Input
          value={draft}
          onChange={(e) => {
            const v = e.target.value.trim();
            setDraft(v);
            if (HEX_COLOR.test(v)) onChange(v.toLowerCase());
          }}
          maxLength={7}
          className="w-28 font-mono"
          aria-invalid={!HEX_COLOR.test(draft)}
        />
      </div>
    </Field>
  );
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** A number on a slider, with its value beside the label. */
export function RangeField({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="grid min-w-44 flex-1 gap-1.5">
      <span className="flex items-center justify-between gap-3 text-sm font-medium">
        {label}
        <span className="tabular-nums text-muted-foreground">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-9 accent-primary" />
    </label>
  );
}

/**
 * One of a few choices as a row of buttons, its words under `words`. With
 * `clearable`, a click on the chosen one goes back to automatic (undefined).
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  words,
  icons,
  clearable,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  words: string;
  icons?: Partial<Record<string, React.ComponentType<{ className?: string }>>>;
  clearable?: boolean;
  onChange: (v: T | undefined) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="grid content-start gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const Icon = icons?.[o];
          const on = value === o;
          const word = t(`${words}.${o}`);
          return (
            <Button
              key={o}
              type="button"
              size="sm"
              variant={on ? "secondary" : "outline"}
              aria-pressed={on}
              aria-label={Icon ? word : undefined}
              title={word}
              className={cn(on && "ring-2 ring-primary/30")}
              onClick={() => onChange(on && clearable ? undefined : o)}
            >
              {Icon ? <Icon className="size-4" /> : word}
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}

const DEVICES = [
  { key: "desktop", width: 1280, icon: Monitor },
  { key: "tablet", width: 768, icon: Tablet },
  { key: "mobile", width: 390, icon: Smartphone },
] as const;

const PICKED = "3px solid rgb(99, 102, 241)";
const HOVERED = "2px dashed rgba(99, 102, 241, 0.75)";

/** The section of the preview an element belongs to (the preview is the site's own page, on the same origin). */
function sectionOf(target: EventTarget | null): HTMLElement | null {
  const el = target as Element | null;
  return el && typeof el.closest === "function" ? (el.closest("[data-section-id]") as HTMLElement | null) : null;
}

/** The preview's page, while it shows the site's own address (another origin cannot be reached). */
function pageOf(frame: HTMLIFrameElement | null): { doc: Document; win: Window } | null {
  try {
    const win = frame?.contentWindow;
    return win?.document ? { doc: win.document, win } : null;
  } catch {
    return null;
  }
}

/** Marks the chosen section in the preview and, on request, scrolls to it. */
function outline(doc: Document, picked: string | null | undefined, scroll: boolean) {
  doc.querySelectorAll<HTMLElement>("[data-section-id]").forEach((el) => {
    const on = !!picked && el.getAttribute("data-section-id") === picked;
    el.style.outline = on ? PICKED : "";
    el.style.outlineOffset = on ? "-3px" : "";
    if (on && scroll) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/** Plays a section's entrance again, as a visitor sees it when scrolling to it. */
function play(doc: Document, id: string) {
  const el = doc.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(id)}"] .site-reveal`);
  if (!el) return;
  el.removeAttribute("data-shown");
  el.setAttribute("data-hidden", "");
  // Lay the hidden state out first, so the entrance starts from it.
  el.getBoundingClientRect();
  doc.defaultView?.requestAnimationFrame(() => {
    el.removeAttribute("data-hidden");
    el.setAttribute("data-shown", "");
  });
}

/**
 * The site as visitors see it (the company sees its draft), at the real
 * width of the chosen device and scaled down to fit. A new `version`
 * reloads it in place, keeping where the person was looking. With
 * `onPick`, a click on a section chooses it for editing (links there are
 * not followed), `picked` is marked and scrolled to, and a new `play`
 * plays its entrance again.
 */
export function Preview({
  src,
  version = 0,
  className,
  picked,
  onPick,
  play: replay = 0,
}: {
  src: string;
  version?: number;
  className?: string;
  picked?: string | null;
  onPick?: (id: string) => void;
  play?: number;
}) {
  const { t } = useI18n();
  const [device, setDevice] = useState<(typeof DEVICES)[number]["key"]>("desktop");
  const [reload, setReload] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const keepY = useRef<number | null>(null);
  const playOnLoad = useRef(false);
  const pickRef = useRef(onPick);
  const pickedRef = useRef(picked);
  useEffect(() => {
    pickRef.current = onPick;
    pickedRef.current = picked;
  });
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const seenVersion = useRef(version);
  useEffect(() => {
    if (seenVersion.current === version) return;
    seenVersion.current = version;
    const p = pageOf(frame.current);
    if (!p) {
      if (frame.current) frame.current.src = src;
      return;
    }
    keepY.current = p.win.scrollY;
    p.win.location.reload();
  }, [version, src]);

  useEffect(() => {
    const p = pageOf(frame.current);
    if (p && pickRef.current) outline(p.doc, picked, true);
  }, [picked]);

  const seenPlay = useRef(replay);
  useEffect(() => {
    if (seenPlay.current === replay) return;
    seenPlay.current = replay;
    const p = pageOf(frame.current);
    if (keepY.current !== null || !p) playOnLoad.current = true;
    else if (pickedRef.current) play(p.doc, pickedRef.current);
  }, [replay]);

  const loaded = () => {
    const p = pageOf(frame.current);
    if (!p) return;
    const { doc, win } = p;
    if (keepY.current !== null) {
      win.scrollTo(0, keepY.current);
      keepY.current = null;
    }
    if (!pickRef.current) return;
    doc.addEventListener(
      "click",
      (e) => {
        const el = sectionOf(e.target);
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        pickRef.current?.(el.getAttribute("data-section-id") ?? "");
      },
      true,
    );
    doc.addEventListener("mouseover", (e) => {
      const el = sectionOf(e.target);
      if (!el || el.getAttribute("data-section-id") === pickedRef.current) return;
      el.style.outline = HOVERED;
      el.style.outlineOffset = "-3px";
      el.style.cursor = "pointer";
    });
    doc.addEventListener("mouseout", (e) => {
      const el = sectionOf(e.target);
      if (!el || el.getAttribute("data-section-id") === pickedRef.current) return;
      el.style.outline = "";
    });
    outline(doc, pickedRef.current, false);
    if (playOnLoad.current && pickedRef.current) {
      playOnLoad.current = false;
      play(doc, pickedRef.current);
    }
  };

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
          ref={frame}
          key={`${device}-${reload}`}
          title={t("store.preview")}
          src={src}
          onLoad={loaded}
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

/** Where a dragged entry would land. */
export function DropLine() {
  return <div aria-hidden className="h-1 rounded-full bg-primary" />;
}

/**
 * Reordering by dragging a handle (mouse, pen or touch): the entry follows
 * the pointer, `lineBefore` says where it would land (before the entry at
 * that index, or after the last at the list's length), and letting go
 * moves it (`move(from, to)`: taken out at `from`, put in at `to`). The
 * arrow buttons stay for the keyboard.
 */
export function useDragSort(move: (from: number, to: number) => void) {
  const nodes = useRef<(HTMLElement | null)[]>([]);
  const state = useRef<{ from: number; startY: number; mids: number[]; to: number } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);

  const finish = (apply: boolean) => {
    const s = state.current;
    state.current = null;
    setDrag(null);
    if (apply && s && s.to !== s.from) move(s.from, s.to);
  };

  /** Props for an entry of the list. */
  const item = (index: number) => ({
    ref: (el: HTMLElement | null) => {
      nodes.current[index] = el;
    },
    style: drag?.from === index ? ({ transform: `translateY(${drag.dy}px)`, position: "relative", zIndex: 30 } as React.CSSProperties) : undefined,
    "data-dragging": drag?.from === index ? "" : undefined,
  });

  /** Props for the handle an entry is dragged by. */
  const handle = (index: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const mids = nodes.current.map((el) => {
        if (!el) return Number.POSITIVE_INFINITY;
        const r = el.getBoundingClientRect();
        return r.top + window.scrollY + r.height / 2;
      });
      state.current = { from: index, startY: e.clientY + window.scrollY, mids, to: index };
      setDrag({ from: index, to: index, dy: 0 });
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = state.current;
      if (!s) return;
      if (e.clientY < 64) window.scrollBy(0, -14);
      else if (e.clientY > window.innerHeight - 64) window.scrollBy(0, 14);
      const y = e.clientY + window.scrollY;
      s.to = s.mids.filter((mid, i) => i !== s.from && mid < y).length;
      setDrag({ from: s.from, to: s.to, dy: y - s.startY });
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    style: { touchAction: "none" } as React.CSSProperties,
  });

  const lineBefore = drag && drag.to !== drag.from ? (drag.to < drag.from ? drag.to : drag.to + 1) : null;
  return { dragging: drag !== null, item, handle, lineBefore };
}
