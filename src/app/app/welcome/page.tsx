import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { cleanIndustries } from "@/lib/industries";
import { APP_MODULES } from "@/lib/modules";
import { requireContext } from "@/server/request";
import { WelcomeView } from "./welcome-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("industries.title") };
}

export default async function WelcomePage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has("settings.manage")) redirect("/app");
  const org = ctx.organization;
  // The company's own choice; the plan's limits (ctx.disabledModules) are not the person's to change here.
  const off = new Set(org.disabledModules);
  return (
    <WelcomeView
      company={org.name}
      current={cleanIndustries(org.industries)}
      enabled={APP_MODULES.filter((m) => !off.has(m))}
      canAutomate={ctx.permissions.has("automation.manage")}
      firstTime={!org.workspaceType}
    />
  );
}
