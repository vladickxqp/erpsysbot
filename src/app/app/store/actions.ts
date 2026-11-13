"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import type { Section, SiteKind, SitePage } from "@/lib/site";
import type { Pages } from "@/lib/store";
import { AssistantError } from "@/server/assistant/run";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { generateSite, rewriteSection, type GeneratedSite, type REWRITE_STYLES } from "@/server/site-ai";
import {
  applySite,
  createStore,
  deleteStore,
  discardChanges,
  publishChanges,
  saveBasics,
  savePages,
  savePayments,
  saveSections,
  saveShippingOptions,
  saveSitePages,
  saveTheme,
  setStoreStatus,
  siteBasics,
  StoreError,
  type ApplyInput,
  type BasicsInput,
  type PageListInput,
  type ThemeInput,
} from "@/server/stores";

export type StoreResult = { ok?: boolean; id?: string; error?: string; failed?: string[]; pages?: SitePage[] };

const AI_ERROR = { NOT_CONFIGURED: "assistant.notConfigured", LIMIT: "assistant.limit", BUSY: "assistant.busy", REFUSED: "assistant.refused", FAILED: "assistant.failed" } as const;

function failure(e: unknown): StoreResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  if (e instanceof StoreError) return { error: e.code === "KIND" || e.code === "PAGE_SLUG" ? `sites.error.${e.code}` : `store.error.${e.code}`, failed: e.failed };
  if (e instanceof AssistantError) return { error: AI_ERROR[e.code] };
  throw e;
}

async function run(work: () => Promise<StoreResult | void>): Promise<StoreResult> {
  try {
    const result = (await work()) ?? {};
    revalidatePath("/app/store", "layout");
    revalidatePath("/app/sites", "layout");
    return { ok: true, ...result };
  } catch (e) {
    return failure(e);
  }
}

export async function createStoreAction(name: string, kind: SiteKind = "store"): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(async () => ({ id: (await createStore(ctx, { name, kind })).id }));
}

export async function saveBasicsAction(id: string, input: BasicsInput): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => saveBasics(ctx, id, input));
}

export async function saveThemeAction(id: string, input: ThemeInput): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => saveTheme(ctx, id, input));
}

/** `page`: "home" or the id of one of the site's own pages. */
export async function saveSectionsAction(id: string, page: string, sections: Section[]): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => saveSections(ctx, id, page, sections));
}

export async function saveSitePagesAction(id: string, pages: PageListInput): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(async () => ({ pages: await saveSitePages(ctx, id, pages) }));
}

export async function savePagesAction(id: string, pages: Pages): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => savePages(ctx, id, pages));
}

export async function saveShippingAction(id: string, options: { id?: string; name: string; priceCents: number; freeFromCents: number | null }[]): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => saveShippingOptions(ctx, id, options));
}

export async function savePaymentsAction(
  id: string,
  input: { bank: boolean; stripe: boolean; secretKey?: string; webhookSecret?: string; removeStripe?: boolean },
): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => savePayments(ctx, id, input));
}

export async function setStoreStatusAction(id: string, status: "PUBLISHED" | "UNPUBLISHED"): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => setStoreStatus(ctx, id, status));
}

/** Edits of a published site go online. */
export async function publishChangesAction(id: string): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => publishChanges(ctx, id));
}

/** Edits not yet published are dropped. */
export async function discardChangesAction(id: string): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => discardChanges(ctx, id));
}

export async function deleteStoreAction(id: string, confirmName?: string): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => deleteStore(ctx, id, confirmName));
}

// --- The builder's AI -----------------------------------------------------------------------------

export type GenerateResult = { ok: true; site: GeneratedSite } | { ok: false; error: string };

/** A whole site from a description, as a proposal: nothing is saved yet. */
export async function generateSiteAction(id: string, prompt: string): Promise<GenerateResult> {
  const ctx = await requireContext();
  try {
    return { ok: true, site: await generateSite(ctx, await siteBasics(ctx, id), { prompt }) };
  } catch (e) {
    return { ok: false, error: failure(e).error ?? "common.error" };
  }
}

/** The proposal taken over: theme, home page and own pages are replaced. */
export async function applySiteAction(id: string, input: ApplyInput): Promise<StoreResult> {
  const ctx = await requireContext();
  return run(() => applySite(ctx, id, input));
}

export type RewriteResult =
  | { ok: true; texts: { title?: string; subtitle?: string; text?: string; buttonLabel?: string; items: { title?: string; text?: string; label?: string }[] } }
  | { ok: false; error: string };

/** Better words for one section, in the site's language; the editor shows them before anything is saved. */
export async function rewriteSectionAction(id: string, style: (typeof REWRITE_STYLES)[number], section: Section): Promise<RewriteResult> {
  const ctx = await requireContext();
  try {
    const site = await siteBasics(ctx, id);
    const texts = await rewriteSection(ctx, site, {
      style,
      section: {
        type: section.type,
        title: section.title,
        subtitle: section.subtitle,
        text: section.text,
        buttonLabel: section.buttonLabel,
        items: (section.items ?? []).map((i) => ({ title: i.title, text: i.text, label: i.label })),
      },
    });
    return { ok: true, texts };
  } catch (e) {
    return { ok: false, error: failure(e).error ?? "common.error" };
  }
}
