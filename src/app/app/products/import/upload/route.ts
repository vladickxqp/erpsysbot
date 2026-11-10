import { NextResponse } from "next/server";
import { ForbiddenError } from "@/server/permissions";
import { MAX_IMPORT_BYTES, ProductImportError, startImport } from "@/server/product-import";
import { activeContext } from "@/server/request";

export const runtime = "nodejs";

/** One product list (field "file") in; the id of its preview out. */
export async function POST(request: Request) {
  const ctx = await activeContext();
  if (!ctx) return NextResponse.json({ error: "auth" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMPORT_BYTES + 100_000) return NextResponse.json({ error: "TOO_LARGE" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file !== "object" || !("arrayBuffer" in file)) return NextResponse.json({ error: "EMPTY" }, { status: 400 });
  if (file.size > MAX_IMPORT_BYTES) return NextResponse.json({ error: "TOO_LARGE" }, { status: 413 });
  try {
    const id = await startImport(ctx, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (e instanceof ProductImportError) return NextResponse.json({ error: e.code }, { status: 400 });
    throw e;
  }
}
