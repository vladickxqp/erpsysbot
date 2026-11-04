"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { AssistantError } from "@/server/assistant/run";
import { localParts, zonedTime } from "@/server/calendar";
import { NotFoundError } from "@/server/clients";
import {
  addComment,
  ContentError,
  createContent,
  deleteComment,
  deleteContent,
  deleteTemplate,
  getContent,
  rescheduleContent,
  saveTemplate,
  updateContent,
  type ContentInput,
  type TemplateInput,
} from "@/server/content";
import { generateContent, type GenerationInput, type Suggestion } from "@/server/content-ai";
import { addDays, parseMoney, today } from "@/server/money";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { publishToTelegram, SocialError } from "@/server/social";
import { deleteSponsorship, invoiceSponsorship, saveSponsorship, SponsorError, type SponsorInput } from "@/server/sponsorships";

export type ContentResult = { ok?: boolean; id?: string; url?: string | null; error?: string };

function failure(e: unknown): ContentResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  if (e instanceof ContentError) return { error: `studio.${e.code}` };
  if (e instanceof SocialError) return { error: `social.${e.code}` };
  if (e instanceof SponsorError) return { error: `sponsors.${e.code}` };
  if (e instanceof AssistantError) return { error: `assistant.${({ NOT_CONFIGURED: "notConfigured", LIMIT: "limit", BUSY: "busy", REFUSED: "refused", FAILED: "failed" } as const)[e.code]}` };
  throw e;
}

const refresh = () => {
  revalidatePath("/app/content", "layout");
  revalidatePath("/app");
};

/** The form sends local date and time; the instant is computed in the company's zone. */
export type ContentPayload = Omit<ContentInput, "scheduledAt"> & { date?: string | null; time?: string | null };

export async function saveContentAction(id: string | null, p: ContentPayload): Promise<ContentResult> {
  const ctx = await requireContext();
  try {
    const { date, time, ...rest } = p;
    const input: ContentInput = { ...rest, scheduledAt: date ? zonedTime(date, time || "10:00", ctx.organization.timezone) : null };
    const item = id ? await updateContent(ctx, id, input) : await createContent(ctx, input);
    refresh();
    return { ok: true, id: item.id };
  } catch (e) {
    return failure(e);
  }
}

/** Moved to another day on the calendar: the time of day stays. */
export async function rescheduleAction(id: string, date: string): Promise<ContentResult> {
  const ctx = await requireContext();
  try {
    const tz = ctx.organization.timezone;
    const { item } = await getContent(ctx, id);
    const time = item.scheduledAt ? localParts(item.scheduledAt, tz).time : "10:00";
    await rescheduleContent(ctx, id, zonedTime(date, time, tz));
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteContentAction(id: string): Promise<ContentResult> {
  const ctx = await requireContext();
  try {
    await deleteContent(ctx, id);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function commentAction(contentId: string, body: string): Promise<ContentResult> {
  const ctx = await requireContext();
  try {
    await addComment(ctx, contentId, body);
    revalidatePath(`/app/content/${contentId}`);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteCommentAction(contentId: string, id: string): Promise<ContentResult> {
  const ctx = await requireContext();
  try {
    await deleteComment(ctx, id);
    revalidatePath(`/app/content/${contentId}`);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function saveTemplateAction(id: string | null, input: TemplateInput): Promise<ContentResult> {
  const ctx = await requireContext();
  try {
    const row = await saveTemplate(ctx, id, input);
    refresh();
    return { ok: true, id: row.id };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteTemplateAction(id: string): Promise<ContentResult> {
  const ctx = await requireContext();
  try {
    await deleteTemplate(ctx, id);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function publishTelegramAction(id: string, accountId: string): Promise<ContentResult> {
  const ctx = await requireContext();
  try {
    const url = await publishToTelegram(ctx, id, accountId);
    refresh();
    return { ok: true, url };
  } catch (e) {
    return failure(e);
  }
}

export async function saveSponsorAction(
  id: string | null,
  p: Omit<SponsorInput, "amountCents"> & { amount: string },
): Promise<ContentResult> {
  const ctx = await requireContext();
  try {
    const { amount, ...rest } = p;
    const row = await saveSponsorship(ctx, id, { ...rest, amountCents: amount.trim() ? (parseMoney(amount) ?? -1) : 0 });
    revalidatePath("/app/content/sponsors");
    return { ok: true, id: row.id };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteSponsorAction(id: string): Promise<ContentResult> {
  const ctx = await requireContext();
  try {
    await deleteSponsorship(ctx, id);
    revalidatePath("/app/content/sponsors");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function invoiceSponsorAction(id: string): Promise<ContentResult> {
  const ctx = await requireContext();
  try {
    const invoice = await invoiceSponsorship(ctx, id);
    revalidatePath("/app/content/sponsors");
    revalidatePath("/app/invoices");
    return { ok: true, id: invoice.id };
  } catch (e) {
    return failure(e);
  }
}

export async function generateAction(input: GenerationInput): Promise<{ items?: Suggestion[]; error?: string }> {
  const ctx = await requireContext();
  try {
    return { items: await generateContent(ctx, input) };
  } catch (e) {
    return { error: failure(e).error };
  }
}

/**
 * Keeps chosen suggestions as drafts (a content plan: as ideas on their days,
 * from tomorrow on). Nothing is scheduled or published by this.
 */
export async function keepSuggestionsAction(
  items: { title: string; text: string; hashtags: string[]; day: number }[],
  base: { platform: ContentInput["platform"]; contentType: ContentInput["contentType"]; plan: boolean },
): Promise<ContentResult & { count?: number }> {
  const ctx = await requireContext();
  try {
    const tz = ctx.organization.timezone;
    const start = today(tz);
    let created = 0;
    for (const s of items.slice(0, 30)) {
      await createContent(ctx, {
        title: s.title.slice(0, 300) || "—",
        body: s.text,
        hashtags: s.hashtags,
        platform: base.platform,
        contentType: base.contentType,
        status: base.plan ? "IDEA" : "DRAFT",
        scheduledAt: base.plan && s.day > 0 ? zonedTime(addDays(start, s.day), "10:00", tz) : null,
      });
      created++;
    }
    refresh();
    return { ok: true, count: created };
  } catch (e) {
    return failure(e);
  }
}
