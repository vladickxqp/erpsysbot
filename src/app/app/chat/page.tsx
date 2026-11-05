import { getT } from "@/i18n/server";
import { listChannels, readMessages } from "@/server/chat";
import { requireContext, requireModule } from "@/server/request";
import { memberOptions } from "@/server/team";
import { ChatView } from "./chat-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("hub.chat.title") };
}

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const ctx = await requireContext();
  requireModule(ctx, "chat");
  const { c } = await searchParams;
  const channels = await listChannels(ctx);
  const current = channels.find((x) => x.id === c) ?? channels[0];
  const messages = await readMessages(ctx, current.id);
  const members = (await memberOptions(ctx)).filter((m) => m.id !== ctx.user.userId);
  return <ChatView key={current.id} channels={channels} current={current} initial={messages} members={members} me={ctx.user.userId} />;
}
