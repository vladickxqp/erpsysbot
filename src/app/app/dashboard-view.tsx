"use client";

import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, GripVertical, LayoutGrid, Lightbulb, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { Widget, WidgetSize, WidgetType } from "@/server/dashboards";
import type { WidgetData } from "@/server/widget-data";
import { createDashboardAction, deleteDashboardAction, saveDashboardAction } from "./dashboard-actions";
import { declineWidgetAction, resetDashboardAction } from "./dashboard-actions";
import { widgetTitle, WIDGET_LINK, WidgetBody } from "./widgets";

/** Width on the 4-column grid (2 columns on tablets, 1 on phones). */
const SPAN: Record<WidgetSize, string> = {
  1: "xl:col-span-1",
  2: "md:col-span-2 xl:col-span-2",
  3: "md:col-span-2 xl:col-span-3",
  4: "md:col-span-2 xl:col-span-4",
};

export function DashboardView({
  company,
  boards,
  active,
  available, offer,
  data,
}: {
  company: string;
  boards: { id: string; name: string }[];
  active: { id: string; name: string; widgets: Widget[] };
  available: { type: WidgetType; size: WidgetSize }[];
  offer: { type: WidgetType; size: WidgetSize; reason: string } | null;
  data: WidgetData;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [widgets, setWidgets] = useState(active.widgets);
  const [boardId, setBoardId] = useState(active.id);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [name, setName] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Another dashboard (or fresh data from the server) replaces the local layout.
  if (boardId !== active.id) {
    setBoardId(active.id);
    setWidgets(active.widgets);
  }

  const persist = (next: Widget[], reload = false) => {
    setWidgets(next);
    start(async () => {
      const res = await saveDashboardAction(active.id, { widgets: next });
      if (res.error) toast.error(t(res.error));
      if (reload || res.error) router.refresh();
    });
  };
  const change = (id: string, patch: Partial<Widget>) => persist(widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const move = (id: string, beforeId: string | null) => {
    const item = widgets.find((w) => w.id === id);
    if (!item || id === beforeId) return;
    const rest = widgets.filter((w) => w.id !== id);
    const at = beforeId ? rest.findIndex((w) => w.id === beforeId) : -1;
    rest.splice(at === -1 ? rest.length : at, 0, item);
    persist(rest);
  };
  const shift = (id: string, dir: -1 | 1) => {
    const i = widgets.findIndex((w) => w.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };
  const add = (type: WidgetType, size: WidgetSize) => {
    setAdding(false);
    persist([...widgets, { id: crypto.randomUUID().slice(0, 8), type, size, collapsed: false }], true);
  };

  return (
    <>
      <PageHeader
        title={t("dashboard.title")}
        description={company}
        actions={
          editing ? (
            <>
              <Button variant="outline" onClick={() => setAdding(true)}>
                <Plus className="size-4" /> {t("widgets.add")}
              </Button>
              <Button onClick={() => setEditing(false)}>{t("widgets.done")}</Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <LayoutGrid className="size-4" /> {t("widgets.customize")}
            </Button>
          )
        }
      />

      {(boards.length > 1 || editing) && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5" role="tablist">
          {boards.map((b) => (
            <Button key={b.id} asChild size="sm" variant={b.id === active.id ? "default" : "outline"} className="rounded-full" role="tab" aria-selected={b.id === active.id}>
              <Link href={`/app?d=${b.id}`}>{b.name}</Link>
            </Button>
          ))}
          {editing && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setName(active.name);
                  setRenaming(true);
                }}
              >
                <Pencil className="size-3.5" /> {t("widgets.rename")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  start(async () => {
                    await resetDashboardAction(active.id);
                    router.refresh();
                  })
                }
              >
                <RotateCcw className="size-3.5" /> {t("hub.widget.reset")}
              </Button>
              {boards.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
                  <Trash2 className="size-3.5" /> {t("common.delete")}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setName("");
                  setCreating(true);
                }}
              >
                <Plus className="size-3.5" /> {t("widgets.newDashboard")}
              </Button>
            </>
          )}
        </div>
      )}

      {offer && !editing && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 text-sm">
          <Lightbulb className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">{t(`hub.widget.offer_${offer.reason}`)}</span>
          <Button size="sm" onClick={() => add(offer.type, offer.size)}>
            {t("widgets.add")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              start(async () => {
                await declineWidgetAction(offer.type);
                router.refresh();
              })
            }
          >
            {t("hub.widget.noThanks")}
          </Button>
        </div>
      )}

      {widgets.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={t("widgets.empty")}
          action={
            <Button
              onClick={() => {
                setEditing(true);
                setAdding(true);
              }}
            >
              <Plus className="size-4" /> {t("widgets.add")}
            </Button>
          }
        />
      ) : (
        <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4", pending && "opacity-80")}>
          {widgets.map((w, index) => {
            const link = WIDGET_LINK[w.type];
            return (
              <Card
                key={w.id}
                draggable={editing}
                onDragStart={(e) => {
                  setDragged(w.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", w.id);
                }}
                onDragEnd={() => setDragged(null)}
                onDragOver={(e) => editing && dragged && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragged) move(dragged, w.id);
                  setDragged(null);
                }}
                className={cn(SPAN[w.size], "gap-3 py-4", w.collapsed && "self-start", editing && "cursor-grab border-dashed", dragged === w.id && "opacity-50")}
              >
                <CardHeader className="flex flex-row flex-wrap items-center gap-1 px-4">
                  {editing && <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                  <button
                    type="button"
                    onClick={() => change(w.id, { collapsed: !w.collapsed })}
                    className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"
                    aria-expanded={!w.collapsed}
                    aria-label={w.collapsed ? t("widgets.expand") : t("widgets.collapse")}
                  >
                    {w.collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                  </button>
                  <CardTitle className="min-w-[7rem] flex-1 truncate text-sm font-medium">
                    {link && !editing ? (
                      <Link href={link} className="hover:text-primary">
                        {widgetTitle(t, w.type)}
                      </Link>
                    ) : (
                      widgetTitle(t, w.type)
                    )}
                  </CardTitle>
                  {editing && (
                    <div className="ml-auto flex shrink-0 items-center gap-0.5">
                      <Button variant="ghost" size="icon" className="size-7" disabled={index === 0} onClick={() => shift(w.id, -1)} aria-label={t("widgets.moveBack")}>
                        <ArrowLeft className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-7" disabled={index === widgets.length - 1} onClick={() => shift(w.id, 1)} aria-label={t("widgets.moveForward")}>
                        <ArrowRight className="size-3.5" />
                      </Button>
                      <div className="mx-1 flex rounded-md border" role="group" aria-label={t("widgets.size")}>
                        {([1, 2, 3, 4] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => change(w.id, { size: s })}
                            aria-pressed={w.size === s}
                            className={cn("px-1.5 text-xs tabular-nums", w.size === s ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => persist(widgets.filter((x) => x.id !== w.id))} aria-label={t("widgets.remove")}>
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </CardHeader>
                {!w.collapsed && (
                  <CardContent className="px-4">
                    <WidgetBody type={w.type} data={data} />
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("widgets.add")}</DialogTitle>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-1 overflow-y-auto sm:grid-cols-2">
            {available.map((a) => {
              const placed = widgets.some((w) => w.type === a.type);
              return (
                <button
                  key={a.type}
                  type="button"
                  onClick={() => add(a.type, a.size)}
                  className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/50"
                >
                  <span>{widgetTitle(t, a.type)}</span>
                  {placed ? <span className="text-xs text-muted-foreground">✓</span> : <Plus className="size-4 text-muted-foreground" />}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={creating || renaming} onOpenChange={(v) => !v && (setCreating(false), setRenaming(false))}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{creating ? t("widgets.newDashboard") : t("widgets.rename")}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const template = (new FormData(e.currentTarget).get("template") as "empty" | "default" | null) ?? "empty";
              start(async () => {
                const res = creating ? await createDashboardAction(name, template) : await saveDashboardAction(active.id, { name });
                if (res.error) {
                  toast.error(t(res.error));
                  return;
                }
                setCreating(false);
                setRenaming(false);
                if (creating && res.id) router.push(`/app?d=${res.id}`);
                else router.refresh();
              });
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="board-name">{t("widgets.name")}</Label>
              <Input id="board-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
            </div>
            {creating && (
              <div className="grid gap-1.5 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="template" value="empty" defaultChecked /> {t("widgets.startEmpty")}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="template" value="default" /> {t("widgets.startDefault")}
                </label>
              </div>
            )}
            <DialogFooter>
              <Button type="submit" disabled={pending || !name.trim()}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("common.delete")}
        text={active.name}
        confirm={t("common.delete")}
        destructive
        onConfirm={() => {
          setRemoving(false);
          start(async () => {
            const res = await deleteDashboardAction(active.id);
            if (res.error) toast.error(t(res.error));
            router.push("/app");
            router.refresh();
          });
        }}
      />
    </>
  );
}
