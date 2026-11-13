"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { AssistantError } from "@/server/assistant/run";
import { NotFoundError } from "@/server/clients";
import {
  convertDocument,
  createFromTemplate,
  deleteTemplate,
  DocToolError,
  draftTemplate,
  extractPages,
  imagesToPdfDocument,
  mergePdfDocuments,
  saveTemplate,
  type CreateInput,
  type TemplateInput,
} from "@/server/doc-tools";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export type ToolResult = { ok?: boolean; error?: string; id?: string; name?: string; draft?: { name: string; body: string } };

const AI_ERROR = { NOT_CONFIGURED: "assistant.notConfigured", LIMIT: "assistant.limit", BUSY: "assistant.busy", REFUSED: "assistant.refused", FAILED: "assistant.failed" } as const;

function failure(e: unknown): ToolResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  if (e instanceof DocToolError) return { error: `docs.error.${e.code}` };
  if (e instanceof AssistantError) return { error: AI_ERROR[e.code] };
  throw e;
}

async function run(work: () => Promise<ToolResult | void>): Promise<ToolResult> {
  try {
    const result = (await work()) ?? {};
    revalidatePath("/app/documents", "layout");
    return { ok: true, ...result };
  } catch (e) {
    return failure(e);
  }
}

export async function saveTemplateAction(id: string | null, input: TemplateInput): Promise<ToolResult> {
  const ctx = await requireContext();
  return run(async () => ({ id: await saveTemplate(ctx, id, input) }));
}

export async function deleteTemplateAction(id: string): Promise<ToolResult> {
  const ctx = await requireContext();
  return run(() => deleteTemplate(ctx, id));
}

export async function draftTemplateAction(prompt: string): Promise<ToolResult> {
  const ctx = await requireContext();
  return run(async () => ({ draft: await draftTemplate(ctx, prompt) }));
}

export async function createDocumentAction(input: CreateInput): Promise<ToolResult> {
  const ctx = await requireContext();
  return run(async () => {
    const doc = await createFromTemplate(ctx, input);
    return { id: doc.id, name: doc.name };
  });
}

export async function convertDocumentAction(id: string, to: "pdf" | "docx"): Promise<ToolResult> {
  const ctx = await requireContext();
  return run(async () => {
    const doc = await convertDocument(ctx, id, to);
    return { id: doc.id, name: doc.name };
  });
}

export async function imagesToPdfAction(ids: string[]): Promise<ToolResult> {
  const ctx = await requireContext();
  return run(async () => {
    const doc = await imagesToPdfDocument(ctx, ids);
    return { id: doc.id, name: doc.name };
  });
}

export async function mergePdfsAction(ids: string[]): Promise<ToolResult> {
  const ctx = await requireContext();
  return run(async () => {
    const doc = await mergePdfDocuments(ctx, ids);
    return { id: doc.id, name: doc.name };
  });
}

export async function extractPagesAction(id: string, pages: string): Promise<ToolResult> {
  const ctx = await requireContext();
  return run(async () => {
    const doc = await extractPages(ctx, id, pages);
    return { id: doc.id, name: doc.name };
  });
}
