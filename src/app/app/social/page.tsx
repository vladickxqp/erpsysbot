import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { requirePageContext } from "@/server/request";
import { socialOverview } from "@/server/social";
import { SocialView } from "./social-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("social.title") };
}

export default async function SocialPage() {
  const ctx = await requirePageContext("content.read");
  const { t } = await getT();
  const channels = await socialOverview(ctx);
  return (
    <>
      <PageHeader title={t("social.title")} />
      <SocialView
        channels={channels}
        canConnect={ctx.permissions.has("settings.manage") && !ctx.disabledModules.has("integrations")}
      />
    </>
  );
}
