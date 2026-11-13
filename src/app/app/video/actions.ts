"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import type { VideoFormat, VideoStatus } from "@/lib/video";
import { AssistantError } from "@/server/assistant/run";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { createVideo, deleteVideo, getVideo, planVideo, renderVideo, saveVideo, VideoError, type VideoInput } from "@/server/video";

export type VideoResult = { ok?: boolean; error?: string; id?: string; status?: VideoStatus; progress?: number; outputId?: string | null; failure?: string | null };

const AI_ERROR = { NOT_CONFIGURED: "assistant.notConfigured", LIMIT: "assistant.limit", BUSY: "assistant.busy", REFUSED: "assistant.refused", FAILED: "assistant.failed" } as const;

function failure(e: unknown): VideoResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  if (e instanceof VideoError) return { error: `video.error.${e.code}` };
  if (e instanceof AssistantError) return { error: AI_ERROR[e.code] };
  throw e;
}

async function run(work: () => Promise<VideoResult | void>): Promise<VideoResult> {
  try {
    const result = (await work()) ?? {};
    revalidatePath("/app/video", "layout");
    return { ok: true, ...result };
  } catch (e) {
    return failure(e);
  }
}

export async function createVideoAction(title: string, format: VideoFormat): Promise<VideoResult> {
  const ctx = await requireContext();
  return run(async () => ({ id: (await createVideo(ctx, { title, format })).id }));
}

export async function planVideoAction(topic: string, format: VideoFormat, seconds: number): Promise<VideoResult> {
  const ctx = await requireContext();
  return run(async () => ({ id: (await planVideo(ctx, { topic, format, seconds })).id }));
}

export async function saveVideoAction(id: string, input: VideoInput): Promise<VideoResult> {
  const ctx = await requireContext();
  return run(async () => {
    await saveVideo(ctx, id, input);
  });
}

export async function deleteVideoAction(id: string): Promise<VideoResult> {
  const ctx = await requireContext();
  return run(() => deleteVideo(ctx, id));
}

/** Saves what the editor has and starts the render; the page then asks how far it is. */
export async function renderVideoAction(id: string, input: VideoInput): Promise<VideoResult> {
  const ctx = await requireContext();
  return run(async () => {
    await saveVideo(ctx, id, input);
    await renderVideo(ctx, id);
    return { status: "RENDERING", progress: 0 };
  });
}

export async function videoStatusAction(id: string): Promise<VideoResult> {
  const ctx = await requireContext();
  try {
    const video = await getVideo(ctx, id);
    return { ok: true, status: video.status, progress: video.progress, outputId: video.outputId, failure: video.error };
  } catch (e) {
    return failure(e);
  }
}
