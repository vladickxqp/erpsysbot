import { getT } from "@/i18n/server";
import { assistantAvailable } from "@/server/assistant/run";
import { clientOptions } from "@/server/clients";
import { requirePageContext } from "@/server/request";
import { PlanView } from "./plan-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("hub.plan.title") };
}

export default async function PlanPage() {
  const ctx = await requirePageContext("tasks.manage");
  return <PlanView ai={assistantAvailable() && ctx.permissions.has("ai.use")} clients={ctx.permissions.has("clients.read") ? await clientOptions(ctx) : []} />;
}
