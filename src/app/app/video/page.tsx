import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { assistantAvailable } from "@/server/assistant/run";
import { requirePageContext } from "@/server/request";
import { listVideos } from "@/server/video";
import { VideosView } from "./videos-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("video.title") };
}

export default async function VideosPage() {
  const ctx = await requirePageContext("content.read");
  const { t } = await getT();
  const videos = await listVideos(ctx);
  return (
    <>
      <PageHeader title={t("video.title")} />
      <VideosView
        videos={videos.map((v) => ({ id: v.id, title: v.title, format: v.format, status: v.status, seconds: v.seconds, scenes: v.scenes.length, color: v.color }))}
        canManage={ctx.permissions.has("content.manage")}
        ai={ctx.permissions.has("ai.use") && assistantAvailable()}
      />
    </>
  );
}
