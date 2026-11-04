import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { dayBounds, localParts } from "@/server/calendar";
import { clientOptions } from "@/server/clients";
import { addDays, today } from "@/server/money";
import { requirePageContext } from "@/server/request";
import { listProjects } from "@/server/tasks";
import { listEntries, runningTimer, unbilledByClient } from "@/server/time";
import { TimeView } from "./time-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("time.title") };
}

export default async function TimePage() {
  const ctx = await requirePageContext("time.read");
  const { t } = await getT();
  const tz = ctx.organization.timezone;
  const now = today(tz);
  const from = dayBounds(addDays(now, -30), tz).from;
  const entries = await listEntries(ctx, { from });
  const running = await runningTimer(ctx);
  const unbilled = await unbilledByClient(ctx);
  const clients = ctx.permissions.has("clients.read") ? await clientOptions(ctx) : [];
  const projects = ctx.permissions.has("tasks.read") ? await listProjects(ctx) : [];
  return (
    <>
      <PageHeader title={t("time.title")} />
      <TimeView
        today={now}
        canManage={ctx.permissions.has("time.manage")}
        canBill={ctx.permissions.has("invoices.create")}
        running={running && { id: running.id, description: running.description, startedAt: running.startedAt.toISOString() }}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        unbilled={unbilled}
        entries={entries
          .filter((e) => e.endedAt)
          .map((e) => ({
            id: e.id,
            day: localParts(e.startedAt, tz).date,
            start: localParts(e.startedAt, tz).time,
            end: localParts(e.endedAt!, tz).time,
            minutes: e.minutes,
            description: e.description,
            projectName: e.projectName,
            clientName: e.clientName,
            billable: e.billable,
            billed: !!e.invoiceId,
          }))}
      />
    </>
  );
}
