import { getT } from "@/i18n/server";
import { dayBounds, listAppointments, localParts } from "@/server/calendar";
import { today } from "@/server/money";
import { moduleOn } from "@/server/modules";
import { myPreferences } from "@/server/preferences";
import { requireContext } from "@/server/request";
import { fitIntoDay, myDayTasks, suggestedOrder } from "@/server/task-hub";
import { TodayView } from "./today-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("hub.today.title") };
}

export default async function TodayPage() {
  const ctx = await requireContext();
  const tz = ctx.organization.timezone;
  const day = today(tz);
  const showsTasks = ctx.permissions.has("tasks.read") && moduleOn(ctx, "tasks");
  const showsCalendar = ctx.permissions.has("calendar.read") && moduleOn(ctx, "calendar");
  const [tasks, appointments, prefs] = await Promise.all([
    showsTasks ? myDayTasks(ctx, day) : Promise.resolve([]),
    showsCalendar ? listAppointments(ctx, { ...dayBounds(day, tz), userId: ctx.user.userId, activeOnly: true }) : Promise.resolve([]),
    myPreferences(ctx),
  ]);
  const agenda = appointments.map((a) => ({ id: a.id, title: a.title, from: localParts(a.startsAt, tz).time, to: localParts(a.endsAt, tz).time, clientName: a.clientName }));

  const planned = tasks.filter((x) => x.plannedFor === day);
  const others = tasks.filter((x) => x.plannedFor !== day);
  const weekday = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const work = prefs.workHours?.days.includes(weekday) ? prefs.workHours : null;
  // The plan follows the person's own order; without a working time there is no plan to offer.
  const order = planned.length ? planned : suggestedOrder(others, day).filter((x) => !x.blocked && (!x.dueDate || x.dueDate <= day)).slice(0, 8);
  const schedule = work ? fitIntoDay(order, work, agenda) : null;

  return (
    <TodayView
      day={day}
      planned={planned}
      overdue={suggestedOrder(others.filter((x) => x.dueDate && x.dueDate < day), day)}
      dueToday={suggestedOrder(others.filter((x) => x.dueDate === day), day)}
      upcoming={others.filter((x) => x.dueDate && x.dueDate > day).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))}
      agenda={agenda}
      schedule={schedule}
      hasWorkHours={!!prefs.workHours}
      workingToday={!!work}
      canManage={ctx.permissions.has("tasks.manage")}
    />
  );
}
