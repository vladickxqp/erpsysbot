"use client";

import { ArrowDownRight, ArrowLeft, ArrowUpRight, ListTodo, Scale, Sparkles, Timer, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PageHeader, StatCard } from "@/components/app/page";
import { QuickTaskButton } from "@/components/app/quick-task";
import { UploadButton } from "@/components/app/upload-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { hours } from "../../../time/time-view";
import { saveProjectDetailsAction, setProjectMemberAction } from "../../hub-actions";
import { addProjectCostAction } from "./actions";

type Props = {
  id: string;
  name: string;
  rawDueDate: string | null;
  status: "ACTIVE" | "DONE" | "ARCHIVED";
  description: string | null;
  budgetCents: number | null;
  overBudget: boolean;
  team: { id: string; name: string }[];
  members: { id: string; name: string }[];
  canManage: boolean;
  assistant: boolean;
  clientName: string | null;
  clientId: string | null;
  dueDate: string | null;
  today: string;
  maxMediaBytes: number;
  canUpload: boolean;
  canCost: boolean;
  shows: { time: boolean; files: boolean; costs: boolean; invoices: boolean };
  minutes: number;
  unbilledMinutes: number;
  costCents: number;
  revenueCents: number;
  tasks: { id: string; title: string; status: string; dueDate: string | null }[];
  files: { id: string; name: string }[];
  costs: { id: string; description: string | null; bookedOn: string; amountCents: number }[];
  invoices: { id: string; number: string | null; grossCents: number; status: string }[];
};

export function ProjectView(p: Props) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [pending, start] = useTransition();
  const money = (c: number) => formatMoney(c, locale, region);
  const open = p.tasks.filter((x) => x.status !== "DONE").length;
  const details = (patch: Partial<Parameters<typeof saveProjectDetailsAction>[1]>) =>
    start(async () => {
      const result = await saveProjectDetailsAction(p.id, { name: p.name, clientId: p.clientId, dueDate: p.rawDueDate, status: p.status, description: p.description, budgetCents: p.budgetCents, ...patch });
      if (result.error) toast.error(t(result.error));
      router.refresh();
    });
  const member = (userId: string, on: boolean) =>
    start(async () => {
      const result = await setProjectMemberAction(p.id, userId, on);
      if (result.error) toast.error(t(result.error));
      router.refresh();
    });

  return (
    <>
      <PageHeader
        title={p.name}
        description={[p.clientName, p.dueDate].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            {p.canManage && <QuickTaskButton seed={{ projectId: p.id, clientId: p.clientId }} />}
            {p.assistant && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/assistant?context=project:${p.id}`}>
                  <Sparkles className="size-4" /> {t("hub.ai.askAbout")}
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost">
              <Link href={`/app/tasks?project=${p.id}`}>
                <ArrowLeft className="size-4" /> {t("nav.tasks")}
              </Link>
            </Button>
          </>
        }
      />
      {p.overBudget && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <TriangleAlert className="size-4 shrink-0" aria-hidden /> {t("hub.project.overBudget", { budget: money(p.budgetCents ?? 0), costs: money(p.costCents) })}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("nav.tasks")} value={`${p.tasks.length - open}/${p.tasks.length}`} icon={ListTodo} />
        {p.shows.time && <StatCard label={t("time.title")} value={hours(p.minutes)} hint={p.unbilledMinutes ? `${t("time.unbilled")}: ${hours(p.unbilledMinutes)}` : undefined} icon={Timer} />}
        {p.shows.invoices && <StatCard label={t("finance.income")} value={money(p.revenueCents)} icon={ArrowUpRight} />}
        {p.shows.costs && <StatCard label={t("projectHub.costs")} value={money(p.costCents)} icon={ArrowDownRight} />}
        {p.shows.invoices && p.shows.costs && <StatCard label={t("finance.result")} value={money(p.revenueCents - p.costCents)} icon={Scale} />}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">{t("hub.project.details")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <Textarea
              key={p.description ?? ""}
              defaultValue={p.description ?? ""}
              rows={3}
              disabled={!p.canManage}
              aria-label={t("tasks.description")}
              placeholder={t("tasks.description")}
              onBlur={(e) => e.target.value !== (p.description ?? "") && details({ description: e.target.value || null })}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t("hub.tasks.due")}</span>
                <Input type="date" defaultValue={p.rawDueDate ?? ""} disabled={!p.canManage} onChange={(e) => details({ dueDate: e.target.value || null })} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t("hub.project.budget")}</span>
                <Input
                  inputMode="decimal"
                  defaultValue={p.budgetCents !== null ? String(p.budgetCents / 100) : ""}
                  disabled={!p.canManage}
                  onBlur={(e) => {
                    const value = e.target.value.trim() ? Math.round(Number(e.target.value.replace(",", ".")) * 100) : null;
                    if (value !== p.budgetCents && (value === null || Number.isFinite(value))) details({ budgetCents: value });
                  }}
                />
              </label>
            </div>
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">{t("hub.project.team")}</span>
              <div className="flex flex-wrap gap-1.5">
                {p.team.map((m) => (
                  <span key={m.id} className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5">
                    {m.name}
                    {p.canManage && (
                      <button type="button" aria-label={t("common.delete")} className="text-muted-foreground hover:text-destructive" onClick={() => member(m.id, false)}>
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                ))}
                {p.team.length === 0 && <span className="text-muted-foreground">{t("common.none")}</span>}
              </div>
              {p.canManage && p.members.some((m) => !p.team.some((x) => x.id === m.id)) && (
                <Select value="" onValueChange={(v) => member(v, true)}>
                  <SelectTrigger className="w-full" aria-label={t("hub.project.addMember")}>
                    <SelectValue placeholder={t("hub.project.addMember")} />
                  </SelectTrigger>
                  <SelectContent>
                    {p.members
                      .filter((m) => !p.team.some((x) => x.id === m.id))
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">{t("nav.tasks")}</CardTitle>
          </CardHeader>
          <CardContent className="grid divide-y text-sm">
            {p.tasks.length === 0 && <p className="text-muted-foreground">{t("widgets.noTasks")}</p>}
            {p.tasks.map((task) => (
              <Link key={task.id} href={`/app/tasks/${task.id}`} className="flex items-center gap-2 py-2 hover:text-primary">
                <span className={task.status === "DONE" ? "min-w-0 flex-1 truncate text-muted-foreground line-through" : "min-w-0 flex-1 truncate"}>{task.title}</span>
                {task.dueDate && <span className="text-xs tabular-nums text-muted-foreground">{formatDate(task.dueDate, locale, region)}</span>}
              </Link>
            ))}
          </CardContent>
        </Card>

        {p.shows.files && (
          <Card className="h-fit">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{t("documents.title")}</CardTitle>
              {p.canUpload && <UploadButton variant="outline" media={{ maxBytes: p.maxMediaBytes }} meta={{ projectId: p.id, clientId: p.clientId }} />}
            </CardHeader>
            <CardContent className="grid divide-y text-sm">
              {p.files.length === 0 && <p className="text-muted-foreground">{t("common.none")}</p>}
              {p.files.map((f) => (
                <a key={f.id} href={`/app/documents/${f.id}/file`} target="_blank" rel="noreferrer" className="truncate py-2 hover:text-primary">
                  {f.name}
                </a>
              ))}
            </CardContent>
          </Card>
        )}

        {p.shows.costs && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">{t("projectHub.costs")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {p.canCost && (
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    start(async () => {
                      const res = await addProjectCostAction(p.id, amount, p.today, what);
                      if (res.error) toast.error(t(res.error));
                      else {
                        setAmount("");
                        setWhat("");
                      }
                      router.refresh();
                    });
                  }}
                >
                  <Input className="min-w-40 flex-1" value={what} onChange={(e) => setWhat(e.target.value)} placeholder={t("projectHub.costWhat")} aria-label={t("projectHub.costWhat")} required maxLength={300} />
                  <Input className="w-28" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" aria-label={t("finance.amount")} required />
                  <Button type="submit" variant="outline" disabled={pending}>
                    {t("crm.add")}
                  </Button>
                </form>
              )}
              <div className="grid divide-y">
                {p.costs.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 py-2">
                    <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{formatDate(c.bookedOn, locale, region)}</span>
                    <span className="min-w-0 flex-1 truncate">{c.description}</span>
                    <span className="tabular-nums">{money(c.amountCents)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {p.shows.invoices && p.invoices.length > 0 && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">{t("nav.invoices")}</CardTitle>
            </CardHeader>
            <CardContent className="grid divide-y text-sm">
              {p.invoices.map((i) => (
                <Link key={i.id} href={`/app/invoices/${i.id}`} className="flex items-center gap-3 py-2 hover:text-primary">
                  <span className="min-w-0 flex-1 truncate">{i.number ?? t("invoices.draftNumber")}</span>
                  <span className="tabular-nums">{money(i.grossCents)}</span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
