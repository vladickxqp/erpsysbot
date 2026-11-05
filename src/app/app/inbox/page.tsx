import { getT } from "@/i18n/server";
import { inbox } from "@/server/inbox";
import { requireContext } from "@/server/request";
import { InboxView } from "./inbox-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("hub.inbox.title") };
}

export default async function InboxPage() {
  const ctx = await requireContext();
  return <InboxView items={await inbox(ctx)} />;
}
