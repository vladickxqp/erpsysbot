import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { requirePageContext } from "@/server/request";
import { listStores } from "@/server/stores";
import { StoresView } from "./stores-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("store.title") };
}

export default async function StoresPage() {
  const ctx = await requirePageContext("products.manage");
  const { t } = await getT();
  const stores = await listStores(ctx);
  return (
    <>
      <PageHeader title={t("store.title")} />
      <StoresView stores={stores.map((s) => ({ id: s.id, name: s.name, slug: s.slug, status: s.status }))} canDelete={ctx.permissions.has("settings.manage")} />
    </>
  );
}
