"use server";

import { ZodError } from "zod";
import { createChannel, openDirect, readMessages, sendMessage } from "@/server/chat";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

type Result = { ok?: boolean; id?: string; error?: string };

async function guarded(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    if (e instanceof ZodError) return { error: "auth.check" };
    throw e;
  }
}

export async function sendAction(channelId: string, body: string): Promise<Result> {
  const ctx = await requireContext();
  return guarded(async () => {
    await sendMessage(ctx, channelId, body);
    return { ok: true };
  });
}

export async function newerAction(channelId: string, after: string | null) {
  const ctx = await requireContext();
  return readMessages(ctx, channelId, after ? new Date(after) : undefined);
}

export async function newChannelAction(name: string): Promise<Result> {
  const ctx = await requireContext();
  return guarded(async () => ({ ok: true, id: await createChannel(ctx, name) }));
}

export async function directAction(userId: string): Promise<Result> {
  const ctx = await requireContext();
  return guarded(async () => ({ ok: true, id: await openDirect(ctx, userId) }));
}
