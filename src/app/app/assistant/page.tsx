import { Sparkles } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { pendingActions } from "@/server/assistant/actions";
import { conversationMessages, getConversation, listConversations, readContext } from "@/server/assistant/conversations";
import { assistantAvailable } from "@/server/assistant/run";
import { NotFoundError } from "@/server/clients";
import { requirePageContext } from "@/server/request";
import { Chat } from "./chat";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.ai") };
}

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ ask?: string; c?: string; context?: string; q?: string; archived?: string }> }) {
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
  const sp = await searchParams;
  const archived = sp.archived === "1";
  const conversations = await listConversations(ctx, { q: sp.q, archived });
  const current = sp.c ? await getConversation(ctx, sp.c).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e))) : null;
  const messages = current ? await conversationMessages(ctx, current.id) : [];
  // Without a conversation: everything that still waits, also what came through Telegram.
  const proposals = await pendingActions(ctx, current?.id);
  const context = readContext(sp.context);
  return (
    <Chat
      key={current?.id ?? "new"}
      conversations={conversations.map((c) => ({ id: c.id, title: c.title, contextType: c.contextType, archived: !!c.archivedAt }))}
      current={current ? { id: current.id, title: current.title, archived: !!current.archivedAt } : null}
      initial={messages.map((m) => ({ id: m.id, role: m.role, content: m.content, tools: m.tools }))}
      proposals={proposals.map((a) => ({ id: a.id, tool: a.tool, input: a.input as Record<string, unknown>, status: a.status }))}
      ask={sp.ask?.slice(0, 500)}
      context={context ? `${context.type}:${context.id}` : null}
      contextType={context?.type ?? current?.contextType ?? null}
      query={sp.q ?? ""}
      archived={archived}
    />
  );
}
