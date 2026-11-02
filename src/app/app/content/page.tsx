import { dayBounds, localParts } from "@/server/calendar";
import { getT } from "@/i18n/server";
import { CONTENT_STATUSES, listContent, listTemplates, PLATFORMS, type ContentStatus, type Platform } from "@/server/content";
import { addDays, today } from "@/server/money";
import { requirePageContext } from "@/server/request";
import { ContentView, type StudioView } from "./content-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("studio.title") };
}

/** Monday of the week that holds the date. */
function monday(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; status?: string; platform?: string; q?: string }>;
}) {
  const ctx = await requirePageContext("content.read");
  const sp = await searchParams;
  const tz = ctx.organization.timezone;
  const now = today(tz);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : now;
  const view: StudioView = (["day", "week", "list", "templates"] as const).find((v) => v === sp.view) ?? "month";
  const status = (CONTENT_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as ContentStatus) : undefined;
  const platform = (PLATFORMS as readonly string[]).includes(sp.platform ?? "") ? (sp.platform as Platform) : undefined;

  let first = date;
  let days = 1;
  if (view === "week") {
    first = monday(date);
    days = 7;
  } else if (view === "month") {
    const monthStart = `${date.slice(0, 7)}-01`;
    first = monday(monthStart);
    const next = new Date(`${monthStart}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const last = addDays(next.toISOString().slice(0, 10), -1);
    days = Math.round((Date.parse(`${monday(last)}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 86_400_000) + 7;
  }
  const calendar = view === "day" || view === "week" || view === "month";
  const range = { from: dayBounds(first, tz).from, to: dayBounds(addDays(first, days - 1), tz).to };

  const [items, unplanned, templates] = await Promise.all([
    view === "templates" ? Promise.resolve([]) : listContent(ctx, calendar ? { ...range, platform } : { status, platform, q: sp.q }),
    calendar ? listContent(ctx, { platform }).then((all) => all.filter((i) => !i.scheduledAt && i.status !== "PUBLISHED")) : Promise.resolve([]),
    view === "templates" ? listTemplates(ctx) : Promise.resolve([]),
  ]);
  const row = (i: (typeof items)[number]) => {
    const when = i.publishedAt ?? i.scheduledAt;
    const local = when ? localParts(when, tz) : null;
    return {
      id: i.id,
      title: i.title,
      platform: i.platform,
      contentType: i.contentType,
      status: i.status,
      category: i.category,
      day: local?.date ?? null,
      time: local?.time ?? null,
    };
  };

  return (
    <ContentView
      view={view}
      date={date}
      today={now}
      first={first}
      days={days}
      canManage={ctx.permissions.has("content.manage")}
      canGenerate={ctx.permissions.has("content.manage") && ctx.permissions.has("ai.use")}
      items={items.map(row)}
      unplanned={unplanned.map(row)}
      templates={templates.map((t) => ({ id: t.id, name: t.name, platform: t.platform, contentType: t.contentType, body: t.body, hashtags: t.hashtags }))}
    />
  );
}
