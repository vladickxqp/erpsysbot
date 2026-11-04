import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { requireContext } from "@/server/request";
import { WelcomeView } from "./welcome-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("workspace.title") };
}

export default async function WelcomePage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has("settings.manage")) redirect("/app");
  return <WelcomeView company={ctx.organization.name} />;
}
