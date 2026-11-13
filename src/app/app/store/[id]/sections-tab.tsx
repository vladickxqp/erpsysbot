"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronDown,
  CircleHelp,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  FileText,
  FolderTree,
  GripVertical,
  ImageIcon,
  Images as ImagesIcon,
  LayoutGrid,
  Link2,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Minus,
  Package,
  Play,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Star,
  Target,
  Trash2,
  Undo2,
  Users,
  Video,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import {
  ALIGNS,
  ANCHOR,
  ANIMATIONS,
  BACKGROUNDS,
  COLUMN_SECTIONS,
  embedOf,
  FEATURE_ICONS,
  ITEM_SECTIONS,
  MAX_DELAY,
  MAX_ITEMS,
  MAX_SECTIONS,
  SECTION_GROUPS,
  SHAPE_PATHS,
  SHAPES,
  SPACINGS,
  SPEEDS,
  STORE_ONLY,
  TITLE_SIZES,
  VARIANTS,
  WIDTHS,
  type Background,
  type Section,
  type SectionItem,
  type SectionStyle,
  type SectionType,
  type SiteKind,
} from "@/lib/site";
import { cn } from "@/lib/utils";
import { rewriteSectionAction, saveSectionsAction } from "../actions";
import { ColorField, DropLine, Field, ImagePick, newId, Preview, RangeField, Segmented, useDragSort, type Images } from "./editor-ui";
import "./motion-demo.css";

export const TYPE_ICON: Record<SectionType, LucideIcon> = {
  hero: Sparkles,
  features: LayoutGrid,
  imageText: ImageIcon,
  text: FileText,
  stats: BarChart3,
  gallery: ImagesIcon,
  testimonials: MessageSquare,
  pricing: CreditCard,
  faq: CircleHelp,
  logos: Star,
  team: Users,
  cta: Target,
  video: Video,
  links: Link2,
  products: Package,
  categories: FolderTree,
  newsletter: Mail,
  contactForm: Send,
  contact: MapPin,
  divider: Minus,
};

type SectionField = "subtitle" | "title" | "text" | "button" | "buttonLabel" | "image" | "video" | "products";
const SECTION_FIELDS: Record<SectionType, SectionField[]> = {
  hero: ["subtitle", "title", "text", "button", "image"],
  features: ["subtitle", "title", "text"],
  imageText: ["subtitle", "title", "text", "button", "image"],
  text: ["subtitle", "title", "text", "button"],
  stats: ["subtitle", "title", "text"],
  gallery: ["subtitle", "title", "text"],
  testimonials: ["subtitle", "title", "text"],
  pricing: ["subtitle", "title", "text"],
  faq: ["subtitle", "title", "text"],
  logos: ["title"],
  team: ["subtitle", "title", "text"],
  cta: ["subtitle", "title", "text", "button"],
  video: ["subtitle", "title", "text", "video"],
  links: ["subtitle", "title", "text"],
  products: ["title", "products"],
  categories: ["title"],
  newsletter: ["subtitle", "title", "text", "buttonLabel"],
  contactForm: ["subtitle", "title", "text", "buttonLabel"],
  contact: ["title", "text"],
  divider: [],
};

type ItemField = "icon" | "image" | "title" | "value" | "text" | "label" | "link" | "highlight";
const ITEM_FIELDS: Partial<Record<SectionType, ItemField[]>> = {
  features: ["icon", "title", "text"],
  stats: ["value", "title"],
  gallery: ["image", "title"],
  testimonials: ["text", "label", "title", "image"],
  pricing: ["title", "value", "text", "label", "link", "highlight"],
  faq: ["title", "text"],
  logos: ["image", "title"],
  team: ["image", "title", "value", "text"],
  links: ["title", "link", "text"],
};
/** Fields whose name depends on the section ("Frage" in a FAQ, "Preis" on a price card). */
const NAMED = new Set(["stats.value", "stats.title", "testimonials.text", "testimonials.label", "testimonials.title", "pricing.title", "pricing.value", "pricing.text", "pricing.label", "faq.title", "faq.text", "team.title", "team.value", "gallery.title", "logos.title", "links.text"]);

const STYLES = ["better", "shorter", "longer", "formal", "friendly", "selling"] as const;

/** The parts of a section's style each tab looks after; "reset" there clears only its own. */
const DESIGN_KEYS: (keyof SectionStyle)[] = ["paddingTop", "paddingBottom", "width", "align", "columns", "bgColor", "bgColor2", "angle", "bgImageId", "overlay", "parallax", "tone", "titleSize", "shape", "hideOn", "anchor"];
const MOTION_KEYS: (keyof SectionStyle)[] = ["animation", "speed", "delay", "stagger"];
const COUNTS = ["1", "2", "3", "4"] as const;

/** A style without the parts left at "automatic"; nothing at all when nothing is left. */
function tidy(style: SectionStyle): SectionStyle | undefined {
  const kept = Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined && v !== null && v !== "")) as SectionStyle;
  return Object.keys(kept).length ? kept : undefined;
}

/** A new section with a sensible layout and empty entries to fill in. */
export function newSection(type: SectionType): Section {
  const base: Section = { id: newId(), type, variant: VARIANTS[type]?.[0], title: "", text: "" };
  const items = (n: number, patch: Partial<SectionItem> = {}): SectionItem[] => Array.from({ length: n }, () => ({ id: newId(), ...patch }));
  switch (type) {
    case "features":
      return { ...base, items: ["sparkles", "shield", "heart"].map((icon) => ({ id: newId(), icon })) };
    case "stats":
    case "gallery":
    case "faq":
    case "team":
    case "links":
      return { ...base, items: items(3) };
    case "testimonials":
      return { ...base, background: "soft", items: items(2) };
    case "pricing":
      return { ...base, items: [{ id: newId() }, { id: newId(), highlight: true }, { id: newId() }] };
    case "logos":
      return { ...base, items: items(4) };
    case "products":
      return { ...base, productIds: [], categoryId: null, limit: 8 };
    case "cta":
      return { ...base, background: "brand" };
    default:
      return base;
  }
}

type Props = {
  storeId: string;
  kind: SiteKind;
  /** "home" or the id of one of the site's own pages. */
  page: string;
  initial: Section[];
  previewSrc: string;
  links: { value: string; label: string }[];
  images: Images;
  categories: { id: string; name: string }[];
  products: { id: string; name: string }[];
  ai: boolean;
};

/**
 * The sections of a page: dragged into order, each with its content, its
 * look and its entrance. Changes are saved by themselves a moment after the
 * last one (on a published site as a draft) and the preview follows; a
 * click on a section in the preview opens it here.
 */
export function SectionsEditor({ storeId, kind, page, initial, previewSrc, links, images, categories, products, ai }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [sections, setSections] = useState<Section[]>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [replay, setReplay] = useState(0);
  // Steps back and forward; quick typing in one field counts as one step.
  const [past, setPast] = useState<Section[][]>([]);
  const [future, setFuture] = useState<Section[][]>([]);
  const lastStep = useRef(0);
  // Every change counts up: a save that ends with no newer change leaves nothing unsaved.
  const edits = useRef(0);
  const latest = useRef(sections);
  const busy = useRef(false);
  const queued = useRef<"auto" | "manual" | null>(null);
  const linkList = `site-links-${page}`;

  const edited = () => {
    edits.current += 1;
    setDirty(true);
  };
  const change = (next: Section[]) => {
    const now = Date.now();
    if (now - lastStep.current > 700) setPast((p) => [...p.slice(-49), sections]);
    lastStep.current = now;
    setFuture([]);
    setSections(next);
    edited();
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [sections, ...f]);
    setSections(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    lastStep.current = 0;
    edited();
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, sections]);
    setSections(future[0]);
    setFuture((f) => f.slice(1));
    lastStep.current = 0;
    edited();
  };
  const keys = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (key === "y" || (key === "z" && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  };
  const set = (id: string, patch: Partial<Section>) => change(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const moveTo = (from: number, to: number) => {
    const next = [...sections];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    change(next);
  };
  const sort = useDragSort(moveTo);
  const add = (type: SectionType) => {
    const section = newSection(type);
    change([...sections, section]);
    setOpen(section.id);
    setAdding(false);
  };

  const persist = async (how: "auto" | "manual"): Promise<void> => {
    if (busy.current) {
      if (queued.current !== "manual") queued.current = how;
      return;
    }
    busy.current = true;
    setSaving(true);
    const at = edits.current;
    const result = await saveSectionsAction(storeId, page, latest.current);
    busy.current = false;
    setSaving(false);
    if (result.ok) {
      if (edits.current === at) setDirty(false);
      if (how === "manual") toast.success(t("common.saved"));
      setVersion((v) => v + 1);
      router.refresh();
    } else {
      toast.error([t(result.error ?? "common.error"), ...(result.failed ?? []).map((c) => t(`store.check.${c}`))].join(" · "));
    }
    const next = queued.current;
    queued.current = null;
    if (next) await persist(next);
  };
  const persistRef = useRef(persist);
  useEffect(() => {
    latest.current = sections;
    persistRef.current = persist;
  });
  // A moment after the last change, it is saved by itself.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void persistRef.current("auto"), 1500);
    return () => clearTimeout(timer);
  }, [sections, dirty]);

  /** The preview shows what is saved: save first, then play the section's entrance there. */
  const playEntrance = async () => {
    if (dirty) await persist("auto");
    setReplay((n) => n + 1);
  };
  const pick = (id: string) => {
    setOpen(id);
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className={cn("grid min-w-0 content-start gap-3", sort.dragging && "select-none")} onKeyDown={keys}>
        <datalist id={linkList}>
          {links.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </datalist>
        {sections.map((s, i) => {
          const Icon = TYPE_ICON[s.type];
          const expanded = open === s.id;
          const drag = sort.item(i);
          return (
            <Fragment key={s.id}>
              {sort.lineBefore === i && <DropLine />}
              <Card
                id={`section-${s.id}`}
                data-section-card=""
                ref={drag.ref}
                style={drag.style}
                className={cn("gap-0 py-0 transition-shadow", s.hidden && "opacity-60", expanded && "ring-2 ring-primary/25", drag["data-dragging"] !== undefined && "shadow-2xl ring-2 ring-primary/40")}
              >
                <div className="flex items-center gap-1 px-2 py-2 sm:gap-2">
                  <button
                    type="button"
                    aria-label={t("look.drag")}
                    title={t("look.drag")}
                    className="grid size-8 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground hover:bg-accent active:cursor-grabbing"
                    {...sort.handle(i)}
                  >
                    <GripVertical className="size-4" />
                  </button>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : s.id)}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                      <Icon className="size-4" />
                    </span>
                    <span className="grid min-w-0">
                      <span className="truncate text-sm font-medium">{s.title || t(`sites.type.${s.type}`)}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {t(`sites.type.${s.type}`)}
                        {s.variant ? ` · ${t(`sites.variant.${s.variant}`)}` : ""}
                      </span>
                    </span>
                    <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                  </button>
                  <div className="flex shrink-0 items-center">
                    <Button type="button" variant="ghost" size="icon" aria-label={t("catalog.moveUp")} disabled={i === 0} onClick={() => moveTo(i, i - 1)}>
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={t("catalog.moveDown")} disabled={i === sections.length - 1} onClick={() => moveTo(i, i + 1)}>
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={t(s.hidden ? "sites.show" : "sites.hide")} onClick={() => set(s.id, { hidden: !s.hidden })}>
                      {s.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("sites.duplicate")}
                      disabled={sections.length >= MAX_SECTIONS}
                      onClick={() => {
                        const copy = { ...s, id: newId(), items: (s.items ?? []).map((item) => ({ ...item, id: newId() })) };
                        change([...sections.slice(0, i + 1), copy, ...sections.slice(i + 1)]);
                      }}
                    >
                      <Copy className="size-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => change(sections.filter((x) => x.id !== s.id))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {expanded && (
                  <CardContent className="border-t px-4 pb-4 pt-3">
                    <Tabs defaultValue="content" className="gap-4">
                      <TabsList>
                        <TabsTrigger value="content">{t("look.tab.content")}</TabsTrigger>
                        <TabsTrigger value="design">{t("look.tab.design")}</TabsTrigger>
                        <TabsTrigger value="motion">{t("look.tab.motion")}</TabsTrigger>
                      </TabsList>
                      <TabsContent value="content">
                        <SectionFields
                          storeId={storeId}
                          section={s}
                          onChange={(patch) => set(s.id, patch)}
                          linkList={linkList}
                          images={images}
                          categories={categories}
                          products={products}
                          ai={ai}
                        />
                      </TabsContent>
                      <TabsContent value="design">
                        <StyleFields section={s} onChange={(patch) => set(s.id, patch)} images={images} />
                      </TabsContent>
                      <TabsContent value="motion">
                        <MotionFields section={s} onChange={(patch) => set(s.id, patch)} onPlay={() => void playEntrance()} />
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                )}
              </Card>
            </Fragment>
          );
        })}
        {sort.lineBefore === sections.length && <DropLine />}

        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-sm backdrop-blur">
          <Button type="button" variant="outline" disabled={sections.length >= MAX_SECTIONS} onClick={() => setAdding(true)}>
            <Plus className="size-4" /> {t("sites.addSection")}
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={t("sites.undo")} disabled={!past.length} onClick={undo}>
            <Undo2 className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={t("sites.redo")} disabled={!future.length} onClick={redo}>
            <Undo2 className="size-4 -scale-x-100" />
          </Button>
          {saving ? (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="size-3 animate-spin" /> {t("look.saving")}
            </Badge>
          ) : (
            dirty && <Badge variant="outline">{t("sites.unsaved")}</Badge>
          )}
          <Button type="button" className="ml-auto" disabled={saving} onClick={() => void persist("manual")}>
            {t("common.save")}
          </Button>
        </div>
      </div>

      <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <Preview src={previewSrc} version={version} picked={open} onPick={pick} play={replay} />
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("sites.addSection")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-5">
            {SECTION_GROUPS.map((group) => {
              const types = group.types.filter((type) => kind === "store" || !STORE_ONLY.includes(type));
              if (!types.length) return null;
              return (
                <section key={group.key} className="grid gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`sites.group.${group.key}`)}</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {types.map((type) => {
                      const Icon = TYPE_ICON[type];
                      return (
                        <button key={type} type="button" onClick={() => add(type)} className="grid justify-items-start gap-2 rounded-lg border p-3 text-left text-sm transition hover:border-primary hover:bg-accent">
                          <Icon className="size-5 text-primary" />
                          <span className="font-medium">{t(`sites.type.${type}`)}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionFields({
  storeId,
  section: s,
  onChange,
  linkList,
  images,
  categories,
  products,
  ai,
}: {
  storeId: string;
  section: Section;
  onChange: (patch: Partial<Section>) => void;
  linkList: string;
  images: Images;
  categories: { id: string; name: string }[];
  products: { id: string; name: string }[];
  ai: boolean;
}) {
  const { t } = useI18n();
  const [rewriting, start] = useTransition();
  const fields = SECTION_FIELDS[s.type];
  const variants = VARIANTS[s.type];
  const itemFields = ITEM_FIELDS[s.type];
  const hasText = fields.some((f) => f === "title" || f === "text" || f === "subtitle") || !!itemFields;

  const rewrite = (style: (typeof STYLES)[number]) =>
    start(async () => {
      const result = await rewriteSectionAction(storeId, style, s);
      if (!result.ok) {
        toast.error(t(result.error));
        return;
      }
      const x = result.texts;
      onChange({
        title: x.title ?? s.title,
        subtitle: x.subtitle ?? s.subtitle,
        text: x.text ?? s.text,
        buttonLabel: x.buttonLabel ?? s.buttonLabel,
        items: (s.items ?? []).map((item, i) => ({ ...item, title: x.items[i]?.title ?? item.title, text: x.items[i]?.text ?? item.text, label: x.items[i]?.label ?? item.label })),
      });
    });

  return (
    <div className="grid gap-4">
      {(variants || (ai && hasText)) && (
        <div className="flex flex-wrap items-end gap-3">
          {variants && (
            <Field label={t("sites.field.variant")} className="min-w-40 flex-1">
              <Select value={s.variant ?? variants[0]} onValueChange={(variant) => onChange({ variant })}>
                <SelectTrigger className="w-full" aria-label={t("sites.field.variant")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {variants.map((v) => (
                    <SelectItem key={v} value={v}>
                      {t(`sites.variant.${v}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {ai && hasText && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" disabled={rewriting}>
                  <WandSparkles className={cn("size-4", rewriting && "animate-pulse")} /> {t("sites.ai.rewrite")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {STYLES.map((style) => (
                  <DropdownMenuItem key={style} onSelect={() => rewrite(style)}>
                    {t(`sites.style.${style}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.includes("subtitle") && (
          <Field label={t("sites.field.subtitle")}>
            <Input value={s.subtitle ?? ""} onChange={(e) => onChange({ subtitle: e.target.value })} maxLength={300} />
          </Field>
        )}
        {fields.includes("title") && (
          <Field label={t("sites.field.title")} className={fields.includes("subtitle") ? undefined : "sm:col-span-2"}>
            <Input value={s.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} maxLength={160} />
          </Field>
        )}
        {fields.includes("text") && (
          <Field label={t("sites.field.text")} className="sm:col-span-2">
            <Textarea rows={s.type === "text" ? 8 : 3} value={s.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} maxLength={4000} />
          </Field>
        )}
        {(fields.includes("button") || fields.includes("buttonLabel")) && (
          <Field label={t("sites.field.button")}>
            <Input value={s.buttonLabel ?? ""} onChange={(e) => onChange({ buttonLabel: e.target.value })} maxLength={40} />
          </Field>
        )}
        {fields.includes("button") && (
          <Field label={t("sites.field.link")}>
            <Input list={linkList} value={s.link ?? ""} onChange={(e) => onChange({ link: e.target.value })} maxLength={500} placeholder="https://…" />
          </Field>
        )}
        {fields.includes("image") && (
          <Field label={t("store.image")} className="sm:col-span-2">
            <ImagePick value={s.imageId ?? null} onChange={(imageId) => onChange({ imageId })} images={images} label={t("store.image")} />
          </Field>
        )}
        {fields.includes("video") && (
          <Field label={t("sites.field.videoUrl")} className="sm:col-span-2">
            <Input
              value={s.videoUrl ?? ""}
              onChange={(e) => onChange({ videoUrl: e.target.value })}
              maxLength={300}
              placeholder="https://www.youtube.com/watch?v=…"
              aria-invalid={!!s.videoUrl && !embedOf(s.videoUrl)}
            />
          </Field>
        )}
        {fields.includes("products") && <ProductFields section={s} onChange={onChange} categories={categories} products={products} />}
      </div>

      {itemFields && <ItemsEditor section={s} fields={itemFields} onChange={onChange} linkList={linkList} images={images} />}
    </div>
  );
}

/** A choice from a list, or "automatic" (undefined): what the section's layout and the theme give. */
function Choice<T extends string>({ label, value, options, words, onChange }: { label: string; value: T | undefined; options: readonly T[]; words: string; onChange: (v: T | undefined) => void }) {
  const { t } = useI18n();
  return (
    <Field label={label}>
      <Select value={value ?? "auto"} onValueChange={(v) => onChange(v === "auto" ? undefined : (v as T))}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{t("look.auto")}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {t(`${words}.${o}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** A section's look: space, width, alignment, columns, background, text, heading, lower edge, where it shows, its address. */
function StyleFields({ section: s, onChange, images }: { section: Section; onChange: (patch: Partial<Section>) => void; images: Images }) {
  const { t } = useI18n();
  const st = s.style ?? {};
  const set = (patch: Partial<SectionStyle>) => onChange({ style: tidy({ ...st, ...patch }) });
  const own = !!(st.bgColor || st.bgImageId);
  const reset = () => onChange({ background: undefined, style: tidy(Object.fromEntries(Object.entries(st).filter(([k]) => !DESIGN_KEYS.includes(k as keyof SectionStyle))) as SectionStyle) });

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Choice label={t("look.spaceTop")} value={st.paddingTop} options={SPACINGS} words="look.space" onChange={(paddingTop) => set({ paddingTop })} />
        <Choice label={t("look.spaceBottom")} value={st.paddingBottom} options={SPACINGS} words="look.space" onChange={(paddingBottom) => set({ paddingBottom })} />
        <Choice label={t("look.width")} value={st.width} options={WIDTHS} words="look.widths" onChange={(width) => set({ width })} />
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <Segmented label={t("look.align")} value={st.align} options={ALIGNS} words="look.aligns" icons={{ left: AlignLeft, center: AlignCenter, right: AlignRight }} clearable onChange={(align) => set({ align })} />
        {COLUMN_SECTIONS.includes(s.type) && (
          <Segmented
            label={t("look.columns")}
            value={st.columns ? (String(st.columns) as (typeof COUNTS)[number]) : undefined}
            options={COUNTS}
            words="look.count"
            clearable
            onChange={(c) => set({ columns: c ? Number(c) : undefined })}
          />
        )}
        <Segmented
          label={t("look.titleSize")}
          value={st.titleSize ?? "normal"}
          options={TITLE_SIZES}
          words="look.titleSizes"
          clearable
          onChange={(titleSize) => set({ titleSize: titleSize === "normal" ? undefined : titleSize })}
        />
      </div>

      <fieldset className="grid gap-4 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">{t("look.background")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("look.preset")}>
            <Select value={s.background ?? "auto"} disabled={own} onValueChange={(v) => onChange({ background: v === "auto" ? undefined : (v as Background) })}>
              <SelectTrigger className="w-full" aria-label={t("look.preset")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("sites.bg.auto")}</SelectItem>
                {BACKGROUNDS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {t(`sites.bg.${b}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Choice label={t("look.tone")} value={st.tone === "auto" ? undefined : st.tone} options={["light", "dark"] as const} words="look.tones" onChange={(tone) => set({ tone })} />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex h-9 items-center gap-2 text-sm">
            <Checkbox checked={!!st.bgColor} onCheckedChange={(c) => set(c === true ? { bgColor: st.bgColor ?? "#0f172a" } : { bgColor: undefined, bgColor2: undefined, angle: undefined })} /> {t("look.ownColor")}
          </label>
          {st.bgColor && <ColorField label={t("look.color")} value={st.bgColor} onChange={(bgColor) => set({ bgColor })} />}
          {st.bgColor && (
            <label className="flex h-9 items-center gap-2 text-sm">
              <Checkbox checked={!!st.bgColor2} onCheckedChange={(c) => set(c === true ? { bgColor2: st.bgColor2 ?? "#2563eb", angle: st.angle ?? 135 } : { bgColor2: undefined, angle: undefined })} /> {t("look.gradient")}
            </label>
          )}
          {st.bgColor && st.bgColor2 && <ColorField label={t("look.color2")} value={st.bgColor2} onChange={(bgColor2) => set({ bgColor2 })} />}
        </div>
        {st.bgColor && st.bgColor2 && <RangeField label={t("look.angle")} value={st.angle ?? 135} min={0} max={360} step={15} format={(v) => `${v}°`} onChange={(angle) => set({ angle })} />}
        <Field label={t("look.bgImage")}>
          <ImagePick
            small
            value={st.bgImageId ?? null}
            onChange={(id) => set(id ? { bgImageId: id } : { bgImageId: undefined, overlay: undefined, parallax: undefined })}
            images={images}
            label={t("look.bgImage")}
          />
        </Field>
        {st.bgImageId && (
          <div className="flex flex-wrap items-end gap-4">
            <RangeField label={t("look.overlay")} value={st.overlay ?? 45} min={0} max={90} step={5} format={(v) => `${v} %`} onChange={(overlay) => set({ overlay })} />
            <label className="flex h-9 items-center gap-2 text-sm">
              <Checkbox checked={!!st.parallax} onCheckedChange={(c) => set({ parallax: c === true ? true : undefined })} /> {t("look.parallax")}
            </label>
          </div>
        )}
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("look.shape")}</legend>
        <div className="flex flex-wrap gap-2">
          {SHAPES.map((shape) => {
            const on = (st.shape ?? "none") === shape;
            return (
              <button
                key={shape}
                type="button"
                aria-pressed={on}
                onClick={() => set({ shape: shape === "none" ? undefined : shape })}
                className={cn("grid w-24 justify-items-center gap-1 rounded-lg border p-2 text-xs transition hover:bg-accent", on && "border-primary ring-2 ring-primary/30")}
              >
                <svg aria-hidden viewBox="0 0 1440 80" preserveAspectRatio="none" className="h-6 w-full rounded-sm bg-muted text-primary">
                  <path d={shape === "none" ? "M0,40 L1440,40 L1440,80 L0,80 Z" : SHAPE_PATHS[shape]} fill="currentColor" />
                </svg>
                {t(`look.shapes.${shape}`)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("look.visible")}>
          <Select value={st.hideOn ?? "all"} onValueChange={(v) => set({ hideOn: v === "all" ? undefined : (v as "mobile" | "desktop") })}>
            <SelectTrigger className="w-full" aria-label={t("look.visible")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["all", "mobile", "desktop"] as const).map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`look.visibility.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("look.anchor")}>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">#</span>
            <Input
              value={st.anchor ?? ""}
              onChange={(e) => set({ anchor: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || undefined })}
              maxLength={40}
              aria-invalid={!!st.anchor && !ANCHOR.test(st.anchor)}
            />
          </div>
        </Field>
      </div>

      <div>
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          <RotateCcw className="size-4" /> {t("look.reset")}
        </Button>
      </div>
    </div>
  );
}

/** A section's entrance: the effect, its speed and delay, entries one after another; played in the preview on request. */
function MotionFields({ section: s, onChange, onPlay }: { section: Section; onChange: (patch: Partial<Section>) => void; onPlay: () => void }) {
  const { t, locale } = useI18n();
  const st = s.style ?? {};
  const set = (patch: Partial<SectionStyle>) => onChange({ style: tidy({ ...st, ...patch }) });
  const reset = () => onChange({ style: tidy(Object.fromEntries(Object.entries(st).filter(([k]) => !MOTION_KEYS.includes(k as keyof SectionStyle))) as SectionStyle) });
  const seconds = (ms: number) => `${(ms / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;

  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("look.animation")}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(["theme", ...ANIMATIONS] as const).map((a) => {
            const on = (st.animation ?? "theme") === a;
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => set({ animation: a === "theme" ? undefined : a })}
                className={cn("group grid justify-items-center gap-2 rounded-lg border px-2 py-3 text-xs transition hover:bg-accent", on && "border-primary ring-2 ring-primary/30")}
              >
                <span aria-hidden data-anim={a === "theme" || a === "none" ? undefined : a} className="motion-demo size-6 rounded-md bg-primary/80" />
                {t(`look.animations.${a}`)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <Segmented label={t("look.speed")} value={st.speed} options={SPEEDS} words="look.speeds" clearable onChange={(speed) => set({ speed })} />
        <RangeField label={t("look.delay")} value={st.delay ?? 0} min={0} max={MAX_DELAY} step={100} format={seconds} onChange={(delay) => set({ delay: delay || undefined })} />
      </div>

      {ITEM_SECTIONS.includes(s.type) && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={!!st.stagger} onCheckedChange={(c) => set({ stagger: c === true ? true : undefined })} /> {t("look.stagger")}
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onPlay}>
          <Play className="size-4" /> {t("look.play")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          <RotateCcw className="size-4" /> {t("look.reset")}
        </Button>
      </div>
    </div>
  );
}

function ItemsEditor({ section: s, fields, onChange, linkList, images }: { section: Section; fields: ItemField[]; onChange: (patch: Partial<Section>) => void; linkList: string; images: Images }) {
  const { t } = useI18n();
  const items = s.items ?? [];
  const setItem = (id: string, patch: Partial<SectionItem>) => onChange({ items: items.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  const moveItem = (from: number, to: number) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange({ items: next });
  };
  const sort = useDragSort(moveItem);
  const label = (field: ItemField) => t(NAMED.has(`${s.type}.${field}`) ? `sites.item.${s.type}.${field}` : `sites.field.${field}`);

  return (
    <div className={cn("grid gap-2", sort.dragging && "select-none")}>
      <span className="text-sm font-medium">{t("sites.items")}</span>
      {items.map((item, i) => {
        const drag = sort.item(i);
        return (
          <Fragment key={item.id}>
            {sort.lineBefore === i && <DropLine />}
            <div
              ref={drag.ref}
              style={drag.style}
              className={cn("grid gap-3 rounded-lg border bg-muted/30 p-3", drag["data-dragging"] !== undefined && "bg-background shadow-xl ring-2 ring-primary/40")}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={t("look.drag")}
                    title={t("look.drag")}
                    className="grid size-7 cursor-grab place-items-center rounded text-muted-foreground hover:bg-accent active:cursor-grabbing"
                    {...sort.handle(i)}
                  >
                    <GripVertical className="size-3.5" />
                  </button>
                  <span className="text-xs font-medium text-muted-foreground">{i + 1}</span>
                </div>
                <div className="flex">
                  <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("catalog.moveUp")} disabled={i === 0} onClick={() => moveItem(i, i - 1)}>
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("catalog.moveDown")} disabled={i === items.length - 1} onClick={() => moveItem(i, i + 1)}>
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("common.delete")} onClick={() => onChange({ items: items.filter((x) => x.id !== item.id) })}>
                    <X className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.includes("icon") && (
                  <Field label={label("icon")}>
                    <Select value={item.icon ?? "sparkles"} onValueChange={(icon) => setItem(item.id, { icon })}>
                      <SelectTrigger className="w-full" aria-label={label("icon")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FEATURE_ICONS.map((icon) => (
                          <SelectItem key={icon} value={icon}>
                            {t(`sites.icon.${icon}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                {fields.includes("image") && (
                  <Field label={label("image")} className={fields.includes("icon") ? undefined : "sm:col-span-2"}>
                    <ImagePick small value={item.imageId ?? null} onChange={(imageId) => setItem(item.id, { imageId })} images={images} label={label("image")} />
                  </Field>
                )}
                {fields.includes("title") && (
                  <Field label={label("title")}>
                    <Input value={item.title ?? ""} onChange={(e) => setItem(item.id, { title: e.target.value })} maxLength={160} />
                  </Field>
                )}
                {fields.includes("value") && (
                  <Field label={label("value")}>
                    <Input value={item.value ?? ""} onChange={(e) => setItem(item.id, { value: e.target.value })} maxLength={60} />
                  </Field>
                )}
                {fields.includes("label") && (
                  <Field label={label("label")}>
                    <Input value={item.label ?? ""} onChange={(e) => setItem(item.id, { label: e.target.value })} maxLength={120} />
                  </Field>
                )}
                {fields.includes("link") && (
                  <Field label={label("link")}>
                    <Input list={linkList} value={item.link ?? ""} onChange={(e) => setItem(item.id, { link: e.target.value })} maxLength={500} placeholder="https://…" />
                  </Field>
                )}
                {fields.includes("text") && (
                  <Field label={label("text")} className="sm:col-span-2">
                    <Textarea rows={s.type === "testimonials" || s.type === "pricing" ? 3 : 2} value={item.text ?? ""} onChange={(e) => setItem(item.id, { text: e.target.value })} maxLength={1200} />
                  </Field>
                )}
                {fields.includes("highlight") && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={!!item.highlight} onCheckedChange={(c) => setItem(item.id, { highlight: c === true })} /> {label("highlight")}
                  </label>
                )}
              </div>
            </div>
          </Fragment>
        );
      })}
      {sort.lineBefore === items.length && <DropLine />}
      <div>
        <Button type="button" variant="outline" size="sm" disabled={items.length >= MAX_ITEMS} onClick={() => onChange({ items: [...items, { id: newId(), ...(s.type === "features" ? { icon: "sparkles" } : {}) }] })}>
          <Plus className="size-4" /> {t("sites.addItem")}
        </Button>
      </div>
    </div>
  );
}

function ProductFields({ section: s, onChange, categories, products }: { section: Section; onChange: (patch: Partial<Section>) => void; categories: { id: string; name: string }[]; products: { id: string; name: string }[] }) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t("store.category")}>
        <Select value={s.categoryId ?? "all"} onValueChange={(c) => onChange({ categoryId: c === "all" ? null : c })}>
          <SelectTrigger className="w-full" aria-label={t("store.category")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("store.newest")}</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t("store.limit")}>
        <Input type="number" min={1} max={24} value={s.limit ?? 8} onChange={(e) => onChange({ limit: Number(e.target.value) || 8 })} />
      </Field>
      <div className="grid gap-2 sm:col-span-2">
        <span className="text-sm font-medium">{t("store.chosenProducts")}</span>
        <div className="flex flex-wrap gap-1.5">
          {(s.productIds ?? []).map((pid) => (
            <Badge key={pid} variant="secondary" className="gap-1">
              {products.find((p) => p.id === pid)?.name ?? "?"}
              <button type="button" aria-label={t("common.delete")} onClick={() => onChange({ productIds: (s.productIds ?? []).filter((x) => x !== pid) })}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
        <Select value="" onValueChange={(pid) => onChange({ productIds: [...new Set([...(s.productIds ?? []), pid])].slice(0, 24) })}>
          <SelectTrigger className="w-full sm:w-80" aria-label={t("store.addProduct")}>
            <SelectValue placeholder={t("store.addProduct")} />
          </SelectTrigger>
          <SelectContent>
            {products
              .filter((p) => !(s.productIds ?? []).includes(p.id))
              .map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
