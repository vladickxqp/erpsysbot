"use client";

import { BellRing, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { DealStage } from "@/server/deals";
import { deleteDealAction, moveDealAction, saveDealAction } from "./actions";

const STAGES: DealStage[] = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];

type Deal = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  stage: DealStage;
  valueCents: number;
  source: string | null;
  assignedUserId: string | null;
  nextFollowUp: string | null;
  notes: string | null;
};
type Draft = Omit<Deal, "id" | "clientName" | "valueCents"> & { id: string | null; value: string };

export function PipelineView({
  today,
  me,
  canManage,
  canCreate,
  canDelete,
  clients,
  members,
  stats,
  deals: initial,
}: {
  today: string;
  me: string;
  canManage: boolean;
  canCreate: boolean;
  canDelete: boolean;
  clients: { id: string; name: string; number: number }[];
  members: { id: string; name: string }[];
  stats: { open: { stage: string; count: number; valueCents: number }[]; winRate: number | null };
  deals: Deal[];
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const money = (c: number) => formatMoney(c, locale);
  const [deals, setDeals] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setDeals(initial), [initial]);

  const openValue = stats.open.reduce((s, o) => s + o.valueCents, 0);
  const openCount = stats.open.reduce((s, o) => s + o.count, 0);

  const blank = (stage: DealStage = "NEW"): Draft => ({ id: null, title: "", clientId: "", stage, value: "", source: "", assignedUserId: me, nextFollowUp: null, notes: "" });
  const open = (d: Deal) => setDraft({ ...d, value: d.valueCents ? (d.valueCents / 100).toFixed(2).replace(".", ",") : "" });

  const drop = (stage: DealStage) => {
    const id = dragging;
    setDragging(null);
    if (!id) return;
    setDeals((all) => all.map((d) => (d.id === id ? { ...d, stage } : d)));
    start(async () => {
      const result = await moveDealAction(id, stage);
      if (!result.ok) toast.error(t(result.error ?? "common.error"));
      router.refresh();
    });
  };

  const save = () =>
    draft &&
    start(async () => {
      if (!draft.clientId) {
        toast.error(t("orders.chooseClient"));
        return;
      }
      const cents = Math.round(Number((draft.value || "0").replace(/\./g, "").replace(",", ".")) * 100);
      const result = await saveDealAction(draft.id, {
        title: draft.title,
        clientId: draft.clientId,
        stage: draft.stage,
        valueCents: Number.isFinite(cents) ? cents : 0,
        source: draft.source,
        assignedUserId: draft.assignedUserId,
        nextFollowUp: draft.nextFollowUp,
        notes: draft.notes,
      });
      if (result.ok) {
        setDraft(null);
        router.refresh();
      } else toast.error(t(result.error ?? "common.error"));
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">{t("nav.pipeline")}</h1>
        {canCreate && (
          <Button onClick={() => setDraft(blank())}>
            <Plus className="size-4" /> {t("pipeline.new")}
          </Button>
        )}
      </div>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label={t("pipeline.openValue")} value={money(openValue)} />
        <StatCard label={t("pipeline.openDeals")} value={String(openCount)} />
        <StatCard label={t("pipeline.winRate")} value={stats.winRate === null ? "—" : `${Math.round(stats.winRate * 100)} %`} />
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid min-w-[1100px] grid-cols-7 gap-2">
          {STAGES.map((stage) => {
            const column = deals.filter((d) => d.stage === stage);
            const sum = column.reduce((s, d) => s + d.valueCents, 0);
            return (
              <div
                key={stage}
                className={cn(
                  "flex min-h-48 flex-col gap-2 rounded-xl border p-2",
                  stage === "WON" ? "bg-success/5" : stage === "LOST" ? "bg-muted/50" : "bg-muted/30",
                  dragging && "border-dashed",
                )}
                onDragOver={(e) => canManage && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(stage);
                }}
              >
                <div className="px-1">
                  <div className="text-sm font-medium">
                    {t(`pipeline.${stage}`)} <span className="tabular-nums text-muted-foreground">{column.length}</span>
                  </div>
                  <div className="text-xs tabular-nums text-muted-foreground">{money(sum)}</div>
                </div>
                {column.map((d) => (
                  <div
                    key={d.id}
                    draggable={canManage}
                    onDragStart={() => setDragging(d.id)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => open(d)}
                    className={cn("cursor-pointer rounded-lg border bg-card p-2.5 text-sm shadow-xs hover:border-primary/40", dragging === d.id && "opacity-40")}
                  >
                    <div className="font-medium leading-snug">{d.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{d.clientName}</div>
                    <div className="mt-1.5 flex items-center justify-between text-xs">
                      <span className="tabular-nums font-medium">{d.valueCents ? money(d.valueCents) : ""}</span>
                      {d.nextFollowUp && d.stage !== "WON" && d.stage !== "LOST" && (
                        <span className={cn("flex items-center gap-1", d.nextFollowUp <= today ? "font-medium text-warning" : "text-muted-foreground")}>
                          <BellRing className="size-3" /> {formatDate(d.nextFollowUp, locale)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? t("pipeline.edit") : t("pipeline.new")}</DialogTitle>
            <DialogDescription className="sr-only">{t("nav.pipeline")}</DialogDescription>
          </DialogHeader>
          {draft && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <fieldset disabled={draft.id ? !canManage : !canCreate} className="grid gap-3">
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("pipeline.title")}</span>
                  <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required maxLength={200} autoFocus />
                </label>
                <div className="grid gap-1.5">
                  <Label>{t("orders.client")}</Label>
                  {clients.length === 0 ? (
                    <Link href="/app/clients?new=1" className="text-sm text-primary hover:underline">
                      {t("orders.noClients")}
                    </Link>
                  ) : (
                    <Select value={draft.clientId} onValueChange={(v) => setDraft({ ...draft, clientId: v })}>
                      <SelectTrigger className="w-full" aria-label={t("orders.client")}>
                        <SelectValue placeholder={t("orders.chooseClient")} />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("pipeline.value")}</span>
                    <Input inputMode="decimal" value={draft.value} placeholder="0,00" onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
                  </label>
                  <div className="grid gap-1.5">
                    <Label>{t("pipeline.stage")}</Label>
                    <Select value={draft.stage} onValueChange={(v) => setDraft({ ...draft, stage: v as DealStage })}>
                      <SelectTrigger className="w-full" aria-label={t("pipeline.stage")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STAGES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {t(`pipeline.${s}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("pipeline.followUp")}</span>
                    <Input type="date" value={draft.nextFollowUp ?? ""} onChange={(e) => setDraft({ ...draft, nextFollowUp: e.target.value || null })} />
                  </label>
                  <div className="grid gap-1.5">
                    <Label>{t("calendar.who")}</Label>
                    <Select value={draft.assignedUserId ?? me} onValueChange={(v) => setDraft({ ...draft, assignedUserId: v })}>
                      <SelectTrigger className="w-full" aria-label={t("calendar.who")}>
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
                </div>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("pipeline.source")}</span>
                  <Input value={draft.source ?? ""} onChange={(e) => setDraft({ ...draft, source: e.target.value })} maxLength={80} />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("orders.notes")}</span>
                  <Textarea rows={3} value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                </label>
              </fieldset>
              <DialogFooter className="gap-2 sm:justify-between">
                {draft.id && canDelete ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        await deleteDealAction(draft.id!);
                        setDraft(null);
                        router.refresh();
                      })
                    }
                  >
                    <Trash2 className="size-4" /> {t("common.delete")}
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  {draft.id && (
                    <Button type="button" variant="outline" asChild>
                      <Link href={`/app/quotes/new?client=${draft.clientId}`}>{t("quotes.new")}</Link>
                    </Button>
                  )}
                  <Button type="submit" disabled={pending || (draft.id ? !canManage : !canCreate)}>
                    {t("common.save")}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
