import { notFound } from "next/navigation";
import { formatDate } from "@/i18n";
import { getT } from "@/i18n/server";
import { NotFoundError } from "@/server/clients";
import { maxMediaBytes } from "@/server/documents";
import { today } from "@/server/money";
import { projectHub } from "@/server/project-hub";
import { projectTeam } from "@/server/task-hub";
import { memberOptions } from "@/server/team";
import { assistantAvailable } from "@/server/assistant/run";
import { requirePageContext } from "@/server/request";
import { ProjectView } from "./project-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("tasks.project") };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("tasks.read");
  const { locale, region } = await getT();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const hub = await projectHub(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [team, members] = await Promise.all([projectTeam(ctx, id), memberOptions(ctx)]);
  return (
    <ProjectView
      id={id}
      name={hub.project.name}
      rawDueDate={hub.project.dueDate}
      status={hub.project.status}
      description={hub.project.description}
      budgetCents={hub.project.budgetCents}
      overBudget={hub.overBudget}
      team={team}
      members={members}
      canManage={ctx.permissions.has("tasks.manage")}
      assistant={assistantAvailable() && ctx.permissions.has("ai.use")}
      clientName={hub.clientName}
      clientId={hub.project.clientId}
      dueDate={hub.project.dueDate ? formatDate(hub.project.dueDate, locale, region) : null}
      today={today(ctx.organization.timezone)}
      maxMediaBytes={maxMediaBytes()}
      canUpload={ctx.permissions.has("documents.manage")}
      canCost={ctx.permissions.has("finance.create")}
      shows={hub.shows}
      minutes={hub.minutes}
      unbilledMinutes={hub.unbilledMinutes}
      costCents={hub.costCents}
      revenueCents={hub.revenueCents}
      tasks={hub.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status, dueDate: task.dueDate }))}
      files={hub.files.map((f) => ({ id: f.id, name: f.name }))}
      costs={hub.costs.map((c) => ({ id: c.id, description: c.description, bookedOn: c.bookedOn, amountCents: c.amountCents }))}
      invoices={hub.invoices.map((i) => ({ id: i.id, number: i.number, grossCents: i.grossCents, status: i.status }))}
    />
  );
}
