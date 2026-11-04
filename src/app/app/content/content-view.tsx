"use client";

import { ChevronLeft, ChevronRight, Clapperboard, FileText, Handshake, Plus, Trash2, WandSparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CONTENT_STATUS_CLASS, ContentStatusBadge } from "@/components/app/badges";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FilterChips, SearchBox } from "@/components/app/list-controls";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { intlTag } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { CONTENT_STATUSES, CONTENT_TYPES, PLATFORMS } from "@/lib/content";
import { deleteTemplateAction, rescheduleAction, saveTemplateAction } from "./actions";

export type StudioView = "month" | "week" | "day" | "list" | "templates";
export type ContentRow = { id: string; title: string; platform: string; contentType: string; status: string; category: string | null; day: string | null; time: string | null };
export type TemplateRow = { id: string; name: string; platform: string; contentType: string; body: string; hashtags: string[] };

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const shiftMonth = (iso: string, months: number) => {
  const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

function useNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    start(() => router.push(`${pathname}${q.size ? `?${q}` : ""}`));
  };
  return { go, pending };
}

/** A content item on the calendar: drag it to another day to move it. */
function Chip({ item, draggable }: { item: ContentRow; draggable: boolean }) {
  const { t } = useI18n();
  return (
    <Link
      href={`/app/content/${item.id}`}
      draggable={draggable && item.status !== "PUBLISHED"}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/content-id", item.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn("block truncate rounded-md border px-1.5 py-0.5 text-xs hover:opacity-80", CONTENT_STATUS_CLASS[item.status])}
      title={`${item.title} · ${t(`studio.platform.${item.platform}`)}`}
    >
      {item.time && <span className="mr-1 tabular-nums opacity-70">{item.time}</span>}
      {item.title}
    </Link>
  );
}

function DayCell({
  day,
  items,
  canManage,
  muted,
  isToday,
  label,
  tall,
}: {
  day: string;
  items: ContentRow[];
  canManage: boolean;
  muted?: boolean;
  isToday?: boolean;
  label: string;
  tall?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [, start] = useTransition();
  return (
    <div
      onDragOver={(e) => {
        if (!canManage) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/content-id");
        if (!id) return;
        start(async () => {
          const res = await rescheduleAction(id, day);
          if (res.error) toast.error(t(res.error));
          router.refresh();
        });
      }}
      className={cn(
        "group flex min-w-0 flex-col gap-1 border-b border-r p-1.5",
        tall ? "min-h-64" : "min-h-24",
        muted && "bg-muted/30 text-muted-foreground",
        over && "bg-primary/5 ring-2 ring-inset ring-primary/40",
      )}
    >
      <div className="flex items-center justify-between">
        {label ? (
          <span className={cn("grid size-6 place-items-center rounded-full text-xs", isToday && "bg-primary font-semibold text-primary-foreground")}>{label}</span>
        ) : (
          <span />
        )}
        {canManage && (
          <Link
            href={`/app/content/new?date=${day}`}
            className="grid size-6 place-items-center rounded text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={t("studio.new")}
          >
            <Plus className="size-3.5" />
          </Link>
        )}
      </div>
      {items.map((i) => (
        <Chip key={i.id} item={i} draggable={canManage} />
      ))}
    </div>
  );
}

export function ContentView({
  view,
  date,
  today,
  first,
  days,
  canManage,
  canGenerate,
  items,
  unplanned,
  templates,
}: {
  view: StudioView;
  date: string;
  today: string;
  first: string;
  days: number;
  canManage: boolean;
  canGenerate: boolean;
  items: ContentRow[];
  unplanned: ContentRow[];
  templates: TemplateRow[];
}) {
  const { t, locale, region } = useI18n();
  const { go, pending } = useNav();
  const params = useSearchParams();
  const tag = intlTag(locale, region);
  const calendar = view === "month" || view === "week" || view === "day";
  const dayList = Array.from({ length: days }, (_, i) => shift(first, i));
  const byDay = (day: string) => items.filter((i) => i.day === day).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  const weekday = (iso: string, style: "short" | "long") => new Intl.DateTimeFormat(tag, { weekday: style, timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
  const title =
    view === "month"
      ? new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))
      : view === "week"
        ? `${new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${first}T12:00:00Z`))} – ${new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${shift(first, 6)}T12:00:00Z`))}`
        : new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const step = (dir: 1 | -1) => go({ date: view === "month" ? shiftMonth(date, dir) : shift(date, view === "week" ? 7 * dir : dir) });

  return (
    <>
      <PageHeader
        title={t("studio.title")}
        actions={
          <>
            {canManage && (
              <Button asChild variant="outline">
                <Link href="/app/content/sponsors">
                  <Handshake className="size-4" /> {t("sponsors.title")}
                </Link>
              </Button>
            )}
            {canGenerate && (
              <Button asChild variant="outline">
                <Link href="/app/content/generate">
                  <WandSparkles className="size-4" /> {t("studio.generate")}
                </Link>
              </Button>
            )}
            {canManage && (
              <Button asChild>
                <Link href={`/app/content/new${calendar ? `?date=${date}` : ""}`}>
                  <Plus className="size-4" /> {t("studio.new")}
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border p-1" role="tablist">
          {(["day", "week", "month", "list", "templates"] as const).map((v) => (
            <Button key={v} size="sm" role="tab" aria-selected={view === v} variant={view === v ? "default" : "ghost"} onClick={() => go({ view: v === "month" ? null : v })}>
              {t(`studio.view.${v}`)}
            </Button>
          ))}
        </div>
        {view !== "templates" && (
          <Select value={params.get("platform") ?? "ALL"} onValueChange={(v) => go({ platform: v === "ALL" ? null : v })}>
            <SelectTrigger className="w-44" aria-label={t("studio.platformLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("studio.allPlatforms")}</SelectItem>
              {PLATFORMS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`studio.platform.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {calendar && (
          <div className="ml-auto flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label={t("common.previous")}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => go({ date: null })}>
              {t("calendar.today")}
            </Button>
            <Button variant="outline" size="icon" onClick={() => step(1)} aria-label={t("common.next")}>
              <ChevronRight className="size-4" />
            </Button>
            <span className="ml-2 text-sm font-medium capitalize">{title}</span>
          </div>
        )}
      </div>

      <div className={cn(pending && "opacity-60")}>
        {view === "month" && (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <div className="grid min-w-[42rem] grid-cols-7 border-l border-t">
              {dayList.slice(0, 7).map((d) => (
                <div key={d} className="border-b border-r px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {weekday(d, "short")}
                </div>
              ))}
              {dayList.map((d) => (
                <DayCell key={d} day={d} items={byDay(d)} canManage={canManage} muted={d.slice(0, 7) !== date.slice(0, 7)} isToday={d === today} label={String(Number(d.slice(8)))} />
              ))}
            </div>
          </div>
        )}
        {view === "week" && (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <div className="grid min-w-[42rem] grid-cols-7 border-l border-t">
              {dayList.map((d) => (
                <div key={d} className={cn("border-b border-r px-2 py-1.5 text-xs font-medium text-muted-foreground", d === today && "text-primary")}>
                  {weekday(d, "short")} {Number(d.slice(8))}
                </div>
              ))}
              {dayList.map((d) => (
                <DayCell key={d} day={d} items={byDay(d)} canManage={canManage} label="" tall />
              ))}
            </div>
          </div>
        )}
        {view === "day" && (
          <div className="rounded-xl border bg-card">
            {byDay(date).length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">{t("studio.nothingPlanned")}</div>
            ) : (
              <div className="divide-y">
                {byDay(date).map((i) => (
                  <Link key={i.id} href={`/app/content/${i.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40">
                    <span className="w-12 tabular-nums text-muted-foreground">{i.time}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{i.title}</span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {t(`studio.platform.${i.platform}`)} · {t(`studio.type.${i.contentType}`)}
                    </span>
                    <ContentStatusBadge status={i.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
        {calendar && unplanned.length > 0 && (
          <div className="mt-4 rounded-xl border bg-card p-3">
            <div className="mb-2 text-sm font-medium">{t("studio.unplanned")}</div>
            <div className="flex flex-wrap gap-1.5">
              {unplanned.map((i) => (
                <div key={i.id} className="max-w-60">
                  <Chip item={i} draggable={canManage} />
                </div>
              ))}
            </div>
          </div>
        )}
        {view === "list" && <ListView items={items} />}
        {view === "templates" && <TemplatesView templates={templates} canManage={canManage} />}
      </div>
    </>
  );
}

function ListView({ items }: { items: ContentRow[] }) {
  const { t, locale, region } = useI18n();
  const tag = intlTag(locale, region);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox placeholder={t("common.search")} />
        <FilterChips name="status" options={[{ value: null, label: t("common.all") }, ...CONTENT_STATUSES.map((s) => ({ value: s, label: t(`studio.status.${s}`) }))]} />
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Clapperboard} title={t("studio.empty")} />
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {items.map((i) => (
            <Link key={i.id} href={`/app/content/${i.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{i.title}</div>
                <div className="text-xs text-muted-foreground">
                  {t(`studio.platform.${i.platform}`)} · {t(`studio.type.${i.contentType}`)}
                  {i.category && ` · ${i.category}`}
                </div>
              </div>
              {i.day && (
                <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                  {new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${i.day}T12:00:00Z`))} {i.time}
                </span>
              )}
              <ContentStatusBadge status={i.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const BLANK: Omit<TemplateRow, "id"> = { name: "", platform: "INSTAGRAM", contentType: "POST", body: "", hashtags: [] };

function TemplatesView({ templates, canManage }: { templates: TemplateRow[]; canManage: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<(Omit<TemplateRow, "id"> & { id: string | null }) | null>(null);
  const [tags, setTags] = useState("");
  const [removing, setRemoving] = useState<TemplateRow | null>(null);
  const [pending, start] = useTransition();
  const open = (tpl: TemplateRow | null) => {
    setEditing(tpl ? { ...tpl } : { ...BLANK, id: null });
    setTags((tpl?.hashtags ?? []).join(" "));
  };
  const save = () =>
    editing &&
    start(async () => {
      const res = await saveTemplateAction(editing.id, {
        name: editing.name,
        platform: editing.platform as TemplateRow["platform"] & (typeof PLATFORMS)[number],
        contentType: editing.contentType as (typeof CONTENT_TYPES)[number],
        body: editing.body,
        hashtags: tags,
      });
      if (res.error) toast.error(t(res.error));
      else {
        toast.success(t("common.saved"));
        setEditing(null);
        router.refresh();
      }
    });

  return (
    <div className="grid gap-3">
      {canManage && (
        <div>
          <Button variant="outline" onClick={() => open(null)}>
            <Plus className="size-4" /> {t("studio.newTemplate")}
          </Button>
        </div>
      )}
      {templates.length === 0 ? (
        <EmptyState icon={FileText} title={t("studio.noTemplates")} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((tpl) => (
            <div key={tpl.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{tpl.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t(`studio.platform.${tpl.platform}`)} · {t(`studio.type.${tpl.contentType}`)}
                  </div>
                </div>
                {canManage && (
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => setRemoving(tpl)} aria-label={t("common.delete")}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
              <p className="line-clamp-4 whitespace-pre-line text-sm text-muted-foreground">{tpl.body}</p>
              <div className="mt-auto flex gap-2 pt-1">
                {canManage && (
                  <Button asChild size="sm">
                    <Link href={`/app/content/new?template=${tpl.id}`}>{t("studio.useTemplate")}</Link>
                  </Button>
                )}
                {canManage && (
                  <Button size="sm" variant="outline" onClick={() => open(tpl)}>
                    {t("common.edit")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? t("common.edit") : t("studio.newTemplate")}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-name">{t("studio.templateName")}</Label>
                <Input id="tpl-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required maxLength={120} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>{t("studio.platformLabel")}</Label>
                  <Select value={editing.platform} onValueChange={(v) => setEditing({ ...editing, platform: v })}>
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
                  <Select value={editing.contentType} onValueChange={(v) => setEditing({ ...editing, contentType: v })}>
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
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-body">{t("studio.text")}</Label>
                <Textarea id="tpl-body" rows={8} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-tags">{t("studio.hashtags")}</Label>
                <Input id="tpl-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </form>
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
          const tpl = removing;
          setRemoving(null);
          if (tpl)
            start(async () => {
              const res = await deleteTemplateAction(tpl.id);
              if (res.error) toast.error(t(res.error));
              router.refresh();
            });
        }}
      />
    </div>
  );
}
