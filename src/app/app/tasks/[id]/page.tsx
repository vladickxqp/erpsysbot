import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { assistantAvailable } from "@/server/assistant/run";
import { NotFoundError } from "@/server/clients";
import { maxMediaBytes } from "@/server/documents";
import { localParts } from "@/server/calendar";
import { today } from "@/server/money";
import { requirePageContext } from "@/server/request";
import { taskHub } from "@/server/task-hub";
import { TaskView } from "./task-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("tasks.task") };
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("tasks.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const hub = await taskHub(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const tz = ctx.organization.timezone;
  return (
    <TaskView
      task={{
        id: hub.task.id,
        title: hub.task.title,
        description: hub.task.description,
        status: hub.task.status,
        priority: hub.task.priority,
        dueDate: hub.task.dueDate,
        assignedUserId: hub.task.assignedUserId,
        estimateMinutes: hub.task.estimateMinutes,
        projectId: hub.task.projectId,
        clientId: hub.task.clientId,
      }}
      today={today(tz)}
      me={ctx.user.userId}
      project={hub.project}
      client={hub.client}
      order={hub.order}
      waitsOn={hub.waitsOn}
      blocked={hub.blocked}
      waiting={hub.waiting}
      subtasks={hub.subtasks}
      comments={hub.comments.map((c) => ({ id: c.id, body: c.body, author: c.author, userId: c.userId, at: c.createdAt.toISOString() }))}
      files={hub.files}
      events={hub.events.map((e) => ({ id: e.id, title: e.title, ...localParts(e.startsAt, tz) }))}
      minutes={hub.minutes}
      candidates={hub.candidates}
      members={hub.members}
      hint={hub.hint}
      canManage={ctx.permissions.has("tasks.manage")}
      canSchedule={ctx.permissions.has("calendar.manage")}
      canUpload={ctx.permissions.has("documents.manage")}
      showsFiles={ctx.permissions.has("documents.read")}
      maxMediaBytes={maxMediaBytes()}
      assistant={assistantAvailable() && ctx.permissions.has("ai.use")}
    />
  );
}
