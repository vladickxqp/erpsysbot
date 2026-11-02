import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { integrationStates } from "@/server/integrations";
import { requirePageContext } from "@/server/request";
import { socialOverview } from "@/server/social";
import { IntegrationsView } from "./integrations-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("integrations.title") };
}

export default async function IntegrationsPage() {
  const ctx = await requirePageContext("settings.manage");
  const { t } = await getT();
  const channels = ctx.permissions.has("content.read") ? await socialOverview(ctx) : [];
  return (
    <>
      <PageHeader title={t("integrations.title")} />
      <IntegrationsView
        states={integrationStates()}
        channels={channels.map((c) => ({ id: c.id, provider: c.provider, name: c.name, url: c.url, lastError: c.lastError }))}
      />
    </>
  );
}
