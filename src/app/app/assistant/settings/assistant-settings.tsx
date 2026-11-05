"use client";

import { ArrowLeft, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { deleteAgentAction, deleteMemoryAction, runAgentAction, saveAgentAction, saveMemoryAction } from "../actions";

type Agent = { id: string; name: string; instructions: string; schedule: "DAILY" | "WEEKLY"; enabled: boolean; lastResult: string | null; lastRunAt: string | null };

export function AssistantSettings({ memories, agents }: { memories: { id: string; content: string }[]; agents: Agent[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [fact, setFact] = useState("");
  const [agent, setAgent] = useState<Omit<Agent, "id" | "lastResult" | "lastRunAt"> | null>(null);
  const [pending, start] = useTransition();
  const run = (work: () => Promise<{ error?: string; text?: string }>, then?: () => void) =>
    start(async () => {
      const result = await work();
      if (result.error) toast.error(t(result.error));
      else then?.();
      router.refresh();
    });

  return (
    <>
      <PageHeader
        title={t("hub.ai.memoryAgents")}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/app/assistant">
              <ArrowLeft className="size-4" /> {t("nav.ai")}
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">{t("hub.ai.memory")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {memories.length === 0 && <p className="text-muted-foreground">{t("hub.ai.noMemory")}</p>}
            {memories.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <Input key={m.content} defaultValue={m.content} maxLength={500} aria-label={t("hub.ai.memory")} onBlur={(e) => e.target.value.trim() !== m.content && run(() => saveMemoryAction(m.id, e.target.value))} />
                <Button size="icon" variant="ghost" disabled={pending} aria-label={t("common.delete")} onClick={() => run(() => deleteMemoryAction(m.id))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => saveMemoryAction(null, fact), () => setFact(""));
              }}
            >
              <Input value={fact} onChange={(e) => setFact(e.target.value)} placeholder={t("hub.ai.memoryHint")} aria-label={t("hub.ai.memoryHint")} maxLength={500} required />
              <Button type="submit" size="icon" variant="outline" disabled={pending} aria-label={t("crm.add")}>
                <Plus className="size-4" />
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t("hub.ai.agents")}</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setAgent({ name: "", instructions: "", schedule: "WEEKLY", enabled: true })}>
              <Plus className="size-4" /> {t("hub.ai.newAgent")}
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {agents.length === 0 && !agent && <p className="text-muted-foreground">{t("hub.ai.noAgents")}</p>}
            {agent && (
              <form
                className="grid gap-2 rounded-lg border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => saveAgentAction(null, agent), () => setAgent(null));
                }}
              >
                <Input value={agent.name} onChange={(e) => setAgent({ ...agent, name: e.target.value })} placeholder={t("hub.ai.agentName")} aria-label={t("hub.ai.agentName")} maxLength={80} required autoFocus />
                <Textarea value={agent.instructions} onChange={(e) => setAgent({ ...agent, instructions: e.target.value })} rows={3} placeholder={t("hub.ai.agentHint")} aria-label={t("hub.ai.agentHint")} minLength={10} maxLength={2000} required />
                <div className="flex items-center gap-2">
                  <Select value={agent.schedule} onValueChange={(v) => setAgent({ ...agent, schedule: v as "DAILY" })}>
                    <SelectTrigger className="w-40" aria-label={t("hub.ai.schedule")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAILY">{t("hub.ai.DAILY")}</SelectItem>
                      <SelectItem value="WEEKLY">{t("hub.ai.WEEKLY")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="submit" disabled={pending} className="ml-auto">
                    {t("common.save")}
                  </Button>
                </div>
              </form>
            )}
            {agents.map((a) => (
              <div key={a.id} className="grid gap-1 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Checkbox checked={a.enabled} disabled={pending} aria-label={t("automation.enabled")} onCheckedChange={(v) => run(() => saveAgentAction(a.id, { name: a.name, instructions: a.instructions, schedule: a.schedule, enabled: v === true }))} />
                  <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                  <span className="text-xs text-muted-foreground">{t(`hub.ai.${a.schedule}`)}</span>
                  <Button size="icon" variant="ghost" className="size-7" disabled={pending} aria-label={t("hub.ai.runNow")} onClick={() => run(() => runAgentAction(a.id))}>
                    <Play className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7" disabled={pending} aria-label={t("common.delete")} onClick={() => run(() => deleteAgentAction(a.id))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{a.instructions}</p>
                {a.lastResult && <p className="mt-1 whitespace-pre-wrap rounded bg-muted/60 p-2 text-xs">{a.lastResult}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
