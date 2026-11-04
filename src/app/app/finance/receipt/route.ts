import { NextResponse } from "next/server";
import { AssistantError } from "@/server/assistant/run";
import { ForbiddenError } from "@/server/permissions";
import { readReceipt, ReceiptError } from "@/server/receipts";
import { activeContext } from "@/server/request";

export const runtime = "nodejs";

const ASSISTANT = { NOT_CONFIGURED: "assistant.notConfigured", LIMIT: "assistant.limit", BUSY: "assistant.busy", REFUSED: "assistant.refused", FAILED: "assistant.failed" } as const;

export async function POST(request: Request) {
  const ctx = await activeContext();
  if (!ctx) return NextResponse.json({ error: "common.forbidden" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 11 * 1024 * 1024) return NextResponse.json({ error: "documents.TOO_LARGE" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "documents.EMPTY" }, { status: 400 });
  try {
    return NextResponse.json(await readReceipt(ctx, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }));
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "common.forbidden" }, { status: 403 });
    if (e instanceof ReceiptError) return NextResponse.json({ error: `documents.${e.code}` }, { status: 400 });
    if (e instanceof AssistantError) return NextResponse.json({ error: ASSISTANT[e.code] }, { status: 503 });
    throw e;
  }
}
