import { notFound } from "next/navigation";
import { NotFoundError } from "@/server/clients";
import { listMedia, maxMediaBytes } from "@/server/documents";
import { requirePageContext } from "@/server/request";
import { getVideo, videoAvailable } from "@/server/video";
import { VideoEditor } from "./video-editor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("content.read");
  const video = await getVideo(ctx, (await params).id).catch(() => null);
  return { title: video?.title };
}

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("content.read");
  const video = await getVideo(ctx, (await params).id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const media = ctx.permissions.has("documents.read") ? await listMedia(ctx, {}) : [];
  const pick = (test: RegExp) => media.filter((m) => test.test(m.mimeType)).map((m) => ({ id: m.id, name: m.name, mimeType: m.mimeType }));
  return (
    <VideoEditor
      video={{
        id: video.id,
        title: video.title,
        format: video.format,
        transition: video.transition,
        color: video.color,
        scenes: video.scenes,
        musicId: video.musicId,
        musicVolume: video.musicVolume,
        voiceId: video.voiceId,
        status: video.status,
        progress: video.progress,
        outputId: video.outputId,
        error: video.error,
      }}
      pictures={pick(/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime))$/)}
      sounds={pick(/^audio\//)}
      canManage={ctx.permissions.has("content.manage")}
      canUpload={ctx.permissions.has("documents.manage")}
      canRender={await videoAvailable()}
      maxUpload={maxMediaBytes()}
    />
  );
}
