import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { assistantAvailable } from "@/server/assistant/run";
import { requirePageContext } from "@/server/request";
import { listStores } from "@/server/stores";
import { SitesView } from "./sites-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("sites.title") };
}

export default async function SitesPage() {
  const ctx = await requirePageContext("sites.manage");
  const { t } = await getT();
  const sites = await listStores(ctx, "sites");
  return (
    <>
      <PageHeader title={t("sites.title")} />
      <SitesView
        sites={sites.map((s) => ({ id: s.id, name: s.name, slug: s.slug, status: s.status, kind: s.kind, theme: s.theme }))}
        ai={ctx.permissions.has("ai.use") && assistantAvailable()}
        canDelete={ctx.permissions.has("settings.manage")}
      />
    </>
  );
}
