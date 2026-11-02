import { getT } from "@/i18n/server";
import { clientOptions } from "@/server/clients";
import { listDeals, pipelineStats } from "@/server/deals";
import { today } from "@/server/money";
import { requirePageContext } from "@/server/request";
import { memberOptions } from "@/server/team";
import { PipelineView } from "./pipeline-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.pipeline") };
}

export default async function PipelinePage() {
  const ctx = await requirePageContext("clients.read");
  const [deals, stats, clients, members] = await Promise.all([listDeals(ctx), pipelineStats(ctx), clientOptions(ctx), memberOptions(ctx)]);
  return (
    <PipelineView
      today={today(ctx.organization.timezone)}
      me={ctx.user.userId}
      canManage={ctx.permissions.has("clients.update")}
      canCreate={ctx.permissions.has("clients.create")}
      canDelete={ctx.permissions.has("clients.delete")}
      clients={clients}
      members={members}
      stats={stats}
      deals={deals.map((d) => ({
        id: d.id,
        title: d.title,
        clientId: d.clientId,
        clientName: d.clientName,
        stage: d.stage,
        valueCents: d.valueCents,
        source: d.source,
        assignedUserId: d.assignedUserId,
        nextFollowUp: d.nextFollowUp,
        notes: d.notes,
      }))}
    />
  );
}
