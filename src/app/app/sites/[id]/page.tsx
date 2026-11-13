import { getT } from "@/i18n/server";
import { requirePageContext } from "@/server/request";
import { getStore } from "@/server/stores";
import { editorProps } from "../../store/[id]/load";
import { StoreEditor } from "../../store/[id]/store-editor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
  const ctx = await requirePageContext("sites.manage");
  const site = await getStore(ctx, (await params).id).catch(() => null);
  return { title: site?.name ?? t("sites.title") };
}

export default async function SitePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ai?: string }> }) {
  const ctx = await requirePageContext("sites.manage");
  const props = await editorProps(ctx, (await params).id, "sites");
  return <StoreEditor {...props} openAi={(await searchParams).ai === "1"} />;
}
