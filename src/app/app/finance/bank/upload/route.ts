import { NextResponse } from "next/server";
import { BankError, importStatement } from "@/server/bank";
import { ForbiddenError } from "@/server/permissions";
import { activeContext } from "@/server/request";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

/** A bank statement (CAMT XML or CSV) as field "file". */
export async function POST(request: Request) {
  const ctx = await activeContext();
  if (!ctx) return NextResponse.json({ error: "auth" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES + 100_000) return NextResponse.json({ error: "TOO_LARGE" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "EMPTY" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "TOO_LARGE" }, { status: 413 });
  try {
    const result = await importStatement(ctx, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (e instanceof BankError) return NextResponse.json({ error: e.code }, { status: 400 });
    throw e;
  }
}
