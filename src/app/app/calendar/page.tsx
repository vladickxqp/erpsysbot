import { getT } from "@/i18n/server";
import { dayBounds, listAppointments, localParts } from "@/server/calendar";
import { clientOptions } from "@/server/clients";
import { addDays, today } from "@/server/money";
import { requirePageContext } from "@/server/request";
import { memberOptions } from "@/server/team";
import { CalendarView, type View } from "./calendar-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.calendar") };
}

/** Monday of the week that holds the date. */
function monday(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string; mine?: string; new?: string }> }) {
  const ctx = await requirePageContext("calendar.read");
  const sp = await searchParams;
  const tz = ctx.organization.timezone;
  const now = today(tz);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : now;
  const view: View = sp.view === "day" || sp.view === "week" ? sp.view : "month";
  const mine = sp.mine === "1";

  let first: string;
  let days: number;
  if (view === "day") {
    first = date;
    days = 1;
  } else if (view === "week") {
    first = monday(date);
    days = 7;
  } else {
    const monthStart = `${date.slice(0, 7)}-01`;
    first = monday(monthStart);
    const next = new Date(`${monthStart}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const last = addDays(next.toISOString().slice(0, 10), -1);
    days = Math.round((Date.parse(`${monday(last)}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 86_400_000) + 7;
  }
  const range = { from: dayBounds(first, tz).from, to: dayBounds(addDays(first, days - 1), tz).to };
  const canManage = ctx.permissions.has("calendar.manage");
  const [items, clients, members] = await Promise.all([
    listAppointments(ctx, { ...range, userId: mine ? ctx.user.userId : undefined }),
    canManage && ctx.permissions.has("clients.read") ? clientOptions(ctx) : Promise.resolve([]),
    memberOptions(ctx),
  ]);

  return (
    <CalendarView
      view={view}
      openNew={sp.new === "1"}
      date={date}
      today={now}
      first={first}
      days={days}
      mine={mine}
      timeZone={tz}
      me={ctx.user.userId}
      canManage={canManage}
      clients={clients}
      members={members}
      items={items.map((a) => ({
        id: a.id,
        title: a.title,
        clientId: a.clientId,
        clientName: a.clientName,
        assignedUserId: a.assignedUserId,
        day: localParts(a.startsAt, tz).date,
        start: localParts(a.startsAt, tz).time,
        end: localParts(a.endsAt, tz).time,
        location: a.location,
        status: a.status,
        notes: a.notes,
      }))}
    />
  );
}
