import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AREA_COOKIE, AREA_WIDGETS } from "@/lib/areas";
import { currentArea, shownAreas } from "@/server/areas";
import { getT } from "@/i18n/server";
import { areaDashboard, availableWidgets, listDashboards, suggestedWidget, WIDGETS } from "@/server/dashboards";
import { myInsights } from "@/server/insights";
import { today, addDays } from "@/server/money";
import { moduleOn } from "@/server/modules";
import { myPreferences } from "@/server/preferences";
import { deadlineCount } from "@/server/task-hub";
import { listEntries } from "@/server/time";
import { requireContext } from "@/server/request";
import { loadWidgetData } from "@/server/widget-data";
import { DashboardView } from "./dashboard-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("dashboard.title") };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const ctx = await requireContext();
  // A new workspace starts with the question what it is for.
  if (!ctx.organization.workspaceType && ctx.permissions.has("settings.manage")) redirect("/app/welcome");
  const { t } = await getT();
  const sp = await searchParams;
  // Several areas: each opens with a board of its own.
  const areas = ctx.organization.workspaceType === "PERSONAL" ? [] : shownAreas(ctx);
  const area = areas.length > 1 && !sp.d ? currentArea(areas, (await cookies()).get(AREA_COOKIE)?.value) : null;
  const own = area ? await areaDashboard(ctx, area, t(`areas.${area}`), AREA_WIDGETS[area]) : null;
  const boards = await listDashboards(ctx, t("dashboard.title"));
  const active = boards.find((b) => b.id === (own?.id ?? sp.d)) ?? boards[0];
  const allowed = availableWidgets(ctx);
  const widgets = active.widgets.filter((w) => allowed.includes(w.type));
  const data = await loadWidgetData(ctx, new Set(widgets.map((w) => w.type)));
  const prefs = await myPreferences(ctx);
  const now = today(ctx.organization.timezone);
  const offer = suggestedWidget(ctx, widgets, prefs.dismissedWidgets, {
    deadlines: ctx.permissions.has("tasks.read") && moduleOn(ctx, "tasks") ? await deadlineCount(ctx, now, addDays(now, 7)) : 0,
    insights: (await myInsights(ctx)).length,
    timeEntries: ctx.permissions.has("time.read") && moduleOn(ctx, "time") ? (await listEntries(ctx, { from: new Date(Date.now() - 7 * 86_400_000) })).length : 0,
  });
  return (
    <DashboardView
      company={ctx.organization.name}
      boards={boards.map((b) => ({ id: b.id, name: b.name }))}
      active={{ id: active.id, name: active.name, widgets }}
      offer={offer ? { ...offer, size: WIDGETS[offer.type].size } : null}
      available={allowed.map((type) => ({ type, size: WIDGETS[type].size }))}
      data={data}
    />
  );
}
