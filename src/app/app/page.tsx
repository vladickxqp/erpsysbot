import { getT } from "@/i18n/server";
import { availableWidgets, listDashboards, WIDGETS } from "@/server/dashboards";
import { requireContext } from "@/server/request";
import { loadWidgetData } from "@/server/widget-data";
import { DashboardView } from "./dashboard-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("dashboard.title") };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const ctx = await requireContext();
  const { t } = await getT();
  const sp = await searchParams;
  const boards = await listDashboards(ctx, t("dashboard.title"));
  const active = boards.find((b) => b.id === sp.d) ?? boards[0];
  const allowed = availableWidgets(ctx);
  const widgets = active.widgets.filter((w) => allowed.includes(w.type));
  const data = await loadWidgetData(ctx, new Set(widgets.map((w) => w.type)));
  return (
    <DashboardView
      company={ctx.organization.name}
      boards={boards.map((b) => ({ id: b.id, name: b.name }))}
      active={{ id: active.id, name: active.name, widgets }}
      available={allowed.map((type) => ({ type, size: WIDGETS[type].size }))}
      data={data}
    />
  );
}
