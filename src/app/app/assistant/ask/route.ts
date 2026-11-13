import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { MESSAGES, translator } from "@/i18n";
import type { AssistantAction } from "@/server/assistant/actions";
import { readContext } from "@/server/assistant/conversations";
import { AssistantError, askAssistantDetailed, type Attachment } from "@/server/assistant/run";
import { NotFoundError } from "@/server/clients";
import { DocumentError, sniffType, storeDocument } from "@/server/documents";
import { ForbiddenError } from "@/server/permissions";
import { activeContext } from "@/server/request";

export const runtime = "nodejs";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const READABLE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

const toProposal = (a: AssistantAction) => ({ id: a.id, tool: a.tool, input: a.input as Record<string, unknown>, status: a.status, result: a.result as Record<string, unknown> | null, error: a.error });

/**
 * A question to the assistant, with files if any. The answer comes as a
 * stream of events: each tool as it starts, then the answer (or the error),
 * so the page shows what is happening instead of waiting in silence.
 */
export async function POST(request: Request) {
  const ctx = await activeContext();
  if (!ctx) return NextResponse.json({ error: "FORBIDDEN" }, { status: 401 });
  if (!ctx.permissions.has("ai.use")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_FILES * MAX_FILE_BYTES + 100_000) return NextResponse.json({ error: "FILE_SIZE" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "FAILED" }, { status: 400 });
  const question = String(form.get("question") ?? "");
  const conversationId = String(form.get("conversationId") ?? "") || null;
  const context = String(form.get("context") ?? "") || null;
  const uploads = form.getAll("files").filter((f): f is File => typeof f !== "string");
  if (uploads.length > MAX_FILES) return NextResponse.json({ error: "FILE_COUNT" }, { status: 400 });

  const attachments: Attachment[] = [];
  const t = translator(MESSAGES[ctx.user.locale as keyof typeof MESSAGES] ?? MESSAGES.de);
  for (const file of uploads) {
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "FILE_SIZE" }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffType(bytes, file.name);
    if (!type || !READABLE.has(type)) return NextResponse.json({ error: "FILE_TYPE" }, { status: 400 });
    // Kept under documents when the person may keep files there: receipts must not get lost in a chat.
    let documentId: string | null = null;
    if (ctx.permissions.has("documents.manage")) {
      try {
        documentId = (await storeDocument(ctx, { name: file.name, bytes }, { category: t("aichat.category") })).id;
      } catch (e) {
        if (!(e instanceof DocumentError)) throw e;
      }
    }
    attachments.push({ name: file.name.slice(0, 200), mediaType: type, data: Buffer.from(bytes).toString("base64"), documentId });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        const result = await askAssistantDetailed(ctx, "web", question, undefined, {
          conversationId,
          context: readContext(context),
          attachments,
          onStep: (step) => send({ type: "step", tool: step.tool }),
        });
        // Created records show up on the other pages at once.
        revalidatePath("/app", "layout");
        send({ type: "done", answer: result.answer, tools: result.tools, conversationId: result.conversationId, proposals: result.proposals.map(toProposal) });
      } catch (e) {
        if (e instanceof AssistantError) send({ type: "error", error: e.code });
        else if (e instanceof ForbiddenError) send({ type: "error", error: "FORBIDDEN" });
        else if (e instanceof NotFoundError) send({ type: "error", error: "FAILED" });
        else {
          console.error("assistant: failed", e instanceof Error ? e.message : e);
          send({ type: "error", error: "FAILED" });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}
