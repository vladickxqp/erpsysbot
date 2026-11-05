import { getT } from "@/i18n/server";
import { listAgents } from "@/server/assistant/agents";
import { listMemories } from "@/server/assistant/conversations";
import { requirePageContext } from "@/server/request";
import { AssistantSettings } from "./assistant-settings";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("hub.ai.memoryAgents") };
}

export default async function AssistantSettingsPage() {
  const ctx = await requirePageContext("ai.use");
  const [memories, agents] = await Promise.all([listMemories(ctx), listAgents(ctx)]);
  return (
    <AssistantSettings
      memories={memories.map((m) => ({ id: m.id, content: m.content }))}
      agents={agents.map((a) => ({ id: a.id, name: a.name, instructions: a.instructions, schedule: a.schedule as "DAILY", enabled: a.enabled, lastResult: a.lastResult, lastRunAt: a.lastRunAt?.toISOString() ?? null }))}
    />
  );
}
