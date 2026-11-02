"use client";

import { ArrowRight, CheckCircle2, Plus, Trash2, Workflow, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { deleteAutomationAction, saveAutomationAction } from "./actions";

const TRIGGERS = ["client.created", "order.created", "order.completed", "invoice.overdue", "task.overdue", "stock.low"] as const;
const ACTIONS = ["task.create", "telegram.notify"] as const;
type Trigger = (typeof TRIGGERS)[number];
type Action = (typeof ACTIONS)[number];

type Rule = { id: string; name: string; trigger: string; conditions: Record<string, unknown>; action: string; params: Record<string, unknown>; enabled: boolean };
type Draft = {
  id: string | null;
  name: string;
  trigger: Trigger;
  action: Action;
  minAmount: string;
  minDays: string;
  clientStatus: string;
  title: string;
  message: string;
  dueInDays: string;
  to: string;
  enabled: boolean;
};

const VARS: Record<Trigger, string> = {
  "client.created": "{client} {number}",
  "order.created": "{client} {number} {amount} {title}",
  "order.completed": "{client} {number} {amount} {title}",
  "invoice.overdue": "{client} {number} {amount} {days}",
  "task.overdue": "{title} {due}",
  "stock.low": "{product} {stock} {min}",
};

export function AutomationsView({
  rules,
  runs,
  members,
}: {
  rules: Rule[];
  runs: { id: string; name: string; subject: string; ok: boolean; message: string | null; attempts: number; createdAt: string }[];
  members: { id: string; name: string }[];
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, start] = useTransition();

  const blank: Draft = { id: null, name: "", trigger: "invoice.overdue", action: "task.create", minAmount: "", minDays: "7", clientStatus: "", title: "", message: "", dueInDays: "1", to: "owner", enabled: true };
  const open = (r: Rule) =>
    setDraft({
      id: r.id,
      name: r.name,
      trigger: r.trigger as Trigger,
      action: r.action as Action,
      minAmount: r.conditions.minAmountCents != null ? String(Number(r.conditions.minAmountCents) / 100) : "",
      minDays: r.conditions.minDaysOverdue != null ? String(r.conditions.minDaysOverdue) : "",
      clientStatus: String(r.conditions.clientStatus ?? ""),
      title: String(r.params.title ?? ""),
      message: String(r.params.message ?? ""),
      dueInDays: String(r.params.dueInDays ?? "1"),
      to: String(r.params.to ?? "owner"),
      enabled: r.enabled,
    });

  const payload = (d: Draft) => ({
    name: d.name,
    trigger: d.trigger,
    action: d.action,
    enabled: d.enabled,
    conditions: {
      ...(d.minAmount.trim() ? { minAmountCents: Math.round(Number(d.minAmount.replace(",", ".")) * 100) } : {}),
      ...(d.trigger === "invoice.overdue" && d.minDays.trim() ? { minDaysOverdue: Number(d.minDays) } : {}),
      ...(d.trigger === "client.created" && d.clientStatus ? { clientStatus: d.clientStatus as "LEAD" } : {}),
    },
    params: {
      title: d.title || undefined,
      message: d.message || undefined,
      dueInDays: d.action === "task.create" ? Number(d.dueInDays || "1") : undefined,
      to: d.to,
    },
  });

  const toggle = (r: Rule) =>
    start(async () => {
      const result = await saveAutomationAction(r.id, {
        name: r.name,
        trigger: r.trigger as Trigger,
        action: r.action as Action,
        conditions: r.conditions,
        params: r.params,
        enabled: !r.enabled,
      });
      if (!result.ok) toast.error(t(result.error ?? "common.error"));
      router.refresh();
    });

  const amounts = draft && ["order.created", "order.completed", "invoice.overdue"].includes(draft.trigger);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">{t("automation.title")}</h1>
        <Button onClick={() => setDraft(blank)}>
          <Plus className="size-4" /> {t("automation.new")}
        </Button>
      </div>

      {rules.length === 0 ? (
        <EmptyState icon={Workflow} title={t("automation.empty")} />
      ) : (
        <div className="grid gap-2">
          {rules.map((r) => (
            <div key={r.id} className={cn("flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 text-sm", !r.enabled && "opacity-60")}>
              <Checkbox checked={r.enabled} onCheckedChange={() => toggle(r)} disabled={pending} aria-label={t("automation.enabled")} />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(r)}>
                <div className="font-medium">{r.name}</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {t(`automation.t_${r.trigger.replace(".", "_")}`)} <ArrowRight className="size-3" /> {t(`automation.a_${r.action.replace(".", "_")}`)}
                </div>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("common.delete")}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await deleteAutomationAction(r.id);
                    router.refresh();
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {runs.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">{t("automation.history")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {runs.map((run) => (
              <div key={run.id} className="flex items-center gap-2">
                {run.ok ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <XCircle className="size-4 shrink-0 text-destructive" />}
                <span className="truncate font-medium">{run.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {formatDate(run.createdAt, locale, region)}
                  {!run.ok && run.message ? ` · ${run.message}` : ""}
                  {run.attempts > 1 ? ` · ${run.attempts}×` : ""}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? draft.name : t("automation.new")}</DialogTitle>
            <DialogDescription className="sr-only">{t("automation.title")}</DialogDescription>
          </DialogHeader>
          {draft && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const result = await saveAutomationAction(draft.id, payload(draft));
                  if (result.ok) {
                    setDraft(null);
                    router.refresh();
                  } else toast.error(t(result.error ?? "common.error"));
                });
              }}
            >
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("automation.name")}</span>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={120} autoFocus />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label>{t("automation.when")}</Label>
                  <Select value={draft.trigger} onValueChange={(v) => setDraft({ ...draft, trigger: v as Trigger })}>
                    <SelectTrigger className="w-full" aria-label={t("automation.when")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRIGGERS.map((tr) => (
                        <SelectItem key={tr} value={tr}>
                          {t(`automation.t_${tr.replace(".", "_")}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("automation.then")}</Label>
                  <Select value={draft.action} onValueChange={(v) => setDraft({ ...draft, action: v as Action })}>
                    <SelectTrigger className="w-full" aria-label={t("automation.then")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIONS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {t(`automation.a_${a.replace(".", "_")}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {amounts && (
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("automation.minAmount")}</span>
                    <Input inputMode="decimal" value={draft.minAmount} onChange={(e) => setDraft({ ...draft, minAmount: e.target.value })} />
                  </label>
                )}
                {draft.trigger === "invoice.overdue" && (
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("automation.minDays")}</span>
                    <Input type="number" min={0} value={draft.minDays} onChange={(e) => setDraft({ ...draft, minDays: e.target.value })} />
                  </label>
                )}
                {draft.trigger === "client.created" && (
                  <div className="grid gap-1.5">
                    <Label>{t("orders.status")}</Label>
                    <Select value={draft.clientStatus || "-"} onValueChange={(v) => setDraft({ ...draft, clientStatus: v === "-" ? "" : v })}>
                      <SelectTrigger className="w-full" aria-label={t("orders.status")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="-">{t("common.all")}</SelectItem>
                        <SelectItem value="LEAD">{t("dashboard.leads")}</SelectItem>
                        <SelectItem value="ACTIVE">{t("dashboard.active")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid gap-1.5">
                  <Label>{t("automation.to")}</Label>
                  <Select value={draft.to} onValueChange={(v) => setDraft({ ...draft, to: v })}>
                    <SelectTrigger className="w-full" aria-label={t("automation.to")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">{t("settings.OWNER")}</SelectItem>
                      {draft.action === "telegram.notify" && <SelectItem value="admins">{t("automation.admins")}</SelectItem>}
                      <SelectItem value="assignee">{t("calendar.who")}</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {draft.action === "task.create" && (
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("automation.dueInDays")}</span>
                    <Input type="number" min={0} value={draft.dueInDays} onChange={(e) => setDraft({ ...draft, dueInDays: e.target.value })} />
                  </label>
                )}
              </div>
              {draft.action === "task.create" && (
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("tasks.task")}</span>
                  <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={VARS[draft.trigger]} maxLength={300} />
                </label>
              )}
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("automation.message")}</span>
                <Textarea rows={2} value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} placeholder={VARS[draft.trigger]} maxLength={2000} />
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
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
    </>
  );
}
