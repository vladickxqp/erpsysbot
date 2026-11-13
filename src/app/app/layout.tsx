import { Shell } from "@/components/app/shell";
import { assistantAvailable } from "@/server/assistant/run";
import { billingEnabled } from "@/server/billing";
import { myPreferences } from "@/server/preferences";
import { cookies } from "next/headers";
import { AREA_COOKIE } from "@/lib/areas";
import { currentArea, shownAreas } from "@/server/areas";
import { requireContext } from "@/server/request";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const prefs = await myPreferences(ctx);
  // A private workspace has no areas: its own short menu.
  const areas = ctx.organization.workspaceType === "PERSONAL" ? [] : shownAreas(ctx);
  const area = currentArea(areas, (await cookies()).get(AREA_COOKIE)?.value);
  return (
    <Shell
      user={{ name: ctx.user.name, email: ctx.user.email }}
      company={{ id: ctx.organization.id, name: ctx.organization.name, workspaceType: ctx.organization.workspaceType }}
      favorites={prefs.favorites}
      companies={ctx.companies}
      permissions={[...ctx.permissions]}
      features={[
        ...(assistantAvailable() ? (["assistant"] as const) : []),
        ...(ctx.user.isPlatformAdmin ? (["admin"] as const) : []),
        ...(billingEnabled() ? (["billing"] as const) : []),
      ]}
      offModules={[...ctx.disabledModules, ...ctx.hiddenModules]}
      areas={areas}
      area={area}
    >
      {children}
    </Shell>
  );
}
