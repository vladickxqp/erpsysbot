import { getT } from "@/i18n/server";
import { clientOptions } from "@/server/clients";
import { today } from "@/server/money";
import { myPreferences } from "@/server/preferences";
import { requirePageContext } from "@/server/request";
import { listProjects, listTasks } from "@/server/tasks";
import { memberOptions } from "@/server/team";
import { TasksView } from "./tasks-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.tasks") };
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; project?: string; mine?: string; q?: string; new?: string; newProject?: string }> }) {
  const ctx = await requirePageContext("tasks.read");
  const sp = await searchParams;
  const mine = sp.mine === "1";
  const prefs = await myPreferences(ctx);
  const [tasks, projects, members, clients] = await Promise.all([
    listTasks(ctx, { projectId: sp.project, assignedUserId: mine ? ctx.user.userId : undefined, q: sp.q }),
    listProjects(ctx),
    memberOptions(ctx),
    ctx.permissions.has("clients.read") ? clientOptions(ctx) : Promise.resolve([]),
  ]);
  return (
    <TasksView
      view={sp.view === "list" || sp.view === "board" ? sp.view : (prefs.defaultViews.tasks ?? "board")}
      openNew={sp.new === "1" ? "task" : sp.newProject === "1" ? "project" : null}
      project={sp.project ?? null}
      mine={mine}
      today={today(ctx.organization.timezone)}
      me={ctx.user.userId}
      canManage={ctx.permissions.has("tasks.manage")}
      projects={projects.map((p) => ({ id: p.id, name: p.name, open: p.open }))}
      members={members}
      clients={clients}
      tasks={tasks.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        projectId: task.projectId,
        projectName: task.projectName,
        clientId: task.clientId,
        clientName: task.clientName,
        orderId: task.orderId,
        assignedUserId: task.assignedUserId,
        subtasks: task.subtasks,
        subtasksDone: task.subtasksDone,
        blockers: task.blockers,
      }))}
    />
  );
}
