"use client";

import { ArrowLeft, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createPlanAction, draftPlanAction } from "@/app/app/assistant/actions";
import { PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";

type Row = { title: string; dueDate: string | null; dependsOn: number[] };

/** A project in one go: described, drafted by the assistant if wished, checked, then saved. */
export function PlanView({ ai, clients }: { ai: boolean; clients: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([{ title: "", dueDate: null, dependsOn: [] }]);
  const [drafted, setDrafted] = useState(false);
  const [pending, start] = useTransition();
  const update = (index: number, patch: Partial<Row>) => setRows((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const remove = (index: number) =>
    setRows((list) =>
      list
        .filter((_, i) => i !== index)
        // Positions after the removed one move up, and nothing waits for what is gone.
        .map((r) => ({ ...r, dependsOn: r.dependsOn.filter((d) => d !== index).map((d) => (d > index ? d - 1 : d)) })),
    );

  const draft = () =>
    start(async () => {
      const result = await draftPlanAction(brief);
      if (result.plan) {
        setName(result.plan.name);
        setDescription(result.plan.description);
        setRows(result.plan.tasks);
        setDrafted(true);
      } else toast.error(t(result.error ?? "common.error"));
    });

  const save = () =>
    start(async () => {
      const tasks = rows.filter((r) => r.title.trim());
      const result = await createPlanAction({ name, description: description || null, clientId, tasks: tasks.map((r) => ({ title: r.title, dueDate: r.dueDate, dependsOn: r.dependsOn })) });
      if (result.id) router.push(`/app/tasks/projects/${result.id}`);
      else toast.error(t(result.error ?? "common.error"));
    });

  return (
    <>
      <PageHeader
        title={t("hub.plan.title")}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/app/tasks">
              <ArrowLeft className="size-4" /> {t("nav.tasks")}
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        {ai && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">{t("hub.plan.describe")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={6} maxLength={4000} placeholder={t("hub.plan.hint")} aria-label={t("hub.plan.describe")} />
              <Button onClick={draft} disabled={pending || brief.trim().length < 5} className="w-fit">
                <Sparkles className="size-4" /> {t("hub.plan.draft")}
              </Button>
            </CardContent>
          </Card>
        )}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">{t("hub.plan.check")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {drafted && <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">{t("hub.plan.suggestion")}</p>}
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("hub.plan.name")} aria-label={t("hub.plan.name")} maxLength={200} required />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t("tasks.description")} aria-label={t("tasks.description")} maxLength={5000} />
            {clients.length > 0 && (
              <Select value={clientId ?? "-"} onValueChange={(v) => setClientId(v === "-" ? null : v)}>
                <SelectTrigger className="w-full" aria-label={t("nav.clients")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="-">{t("hub.plan.noClient")}</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="grid gap-2">
              {rows.map((row, index) => (
                <div key={index} className="grid gap-1">
                  <div className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    <Input value={row.title} onChange={(e) => update(index, { title: e.target.value })} placeholder={t("tasks.task")} aria-label={t("tasks.task")} maxLength={300} />
                    <Input type="date" className="w-40 shrink-0" value={row.dueDate ?? ""} onChange={(e) => update(index, { dueDate: e.target.value || null })} aria-label={t("hub.tasks.due")} />
                    <Button size="icon" variant="ghost" className="shrink-0" aria-label={t("common.delete")} onClick={() => remove(index)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {row.dependsOn.length > 0 && (
                    <p className="pl-7 text-xs text-muted-foreground">
                      {t("hub.tasks.dependencies")}: {row.dependsOn.map((d) => d + 1).join(", ")}
                    </p>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-fit" onClick={() => setRows((list) => [...list, { title: "", dueDate: null, dependsOn: [] }])}>
                <Plus className="size-4" /> {t("tasks.task")}
              </Button>
            </div>
            <Button onClick={save} disabled={pending || !name.trim()} className="w-fit">
              {t("hub.plan.create")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
