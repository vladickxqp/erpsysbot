import { Sparkles } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { assistantAvailable, conversation } from "@/server/assistant/run";
import { requirePageContext } from "@/server/request";
import { Chat } from "./chat";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.ai") };
}

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ ask?: string }> }) {
  const ctx = await requirePageContext("ai.use");
  const { t } = await getT();
  if (!assistantAvailable()) {
    return (
      <>
        <PageHeader title={t("nav.ai")} />
        <EmptyState icon={Sparkles} title={t("assistant.notConfigured")} />
      </>
    );
  }
  const messages = await conversation(ctx, "web");
  const { ask } = await searchParams;
  return <Chat initial={messages.map((m) => ({ id: m.id, role: m.role, content: m.content, tools: m.tools }))} ask={ask?.slice(0, 500)} />;
}
