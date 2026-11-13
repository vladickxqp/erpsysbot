import { getT } from "@/i18n/server";
import { requirePageContext } from "@/server/request";
import { getStore } from "@/server/stores";
import { editorProps } from "./load";
import { StoreEditor } from "./store-editor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
  const ctx = await requirePageContext("products.manage");
  const store = await getStore(ctx, (await params).id).catch(() => null);
  return { title: store?.name ?? t("store.title") };
}

export default async function StorePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ai?: string }> }) {
  const ctx = await requirePageContext("products.manage");
  const props = await editorProps(ctx, (await params).id, "store");
  return <StoreEditor {...props} openAi={(await searchParams).ai === "1"} />;
}
