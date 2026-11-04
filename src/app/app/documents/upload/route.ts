import { NextResponse } from "next/server";
import { NotFoundError } from "@/server/clients";
import { DocumentError, MAX_DOCUMENT_BYTES, maxMediaBytes, storeDocument } from "@/server/documents";
import { ForbiddenError } from "@/server/permissions";
import { activeContext } from "@/server/request";

export const runtime = "nodejs";

/** Multipart upload of one or more files (field "file"), with optional client/order/invoice/category/collection. */
export async function POST(request: Request) {
  const ctx = await activeContext();
  if (!ctx) return NextResponse.json({ error: "auth" }, { status: 401 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > Math.max(MAX_DOCUMENT_BYTES * 5, maxMediaBytes()) + 1_000_000) return NextResponse.json({ error: "TOO_LARGE" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "TYPE" }, { status: 400 });
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  const files = form.getAll("file").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f).slice(0, 5);
  if (!files.length) return NextResponse.json({ error: "EMPTY" }, { status: 400 });
  const saved: string[] = [];
  try {
    for (const file of files) {
      const doc = await storeDocument(
        ctx,
        { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
        { category: field("category"), collection: field("collection"), projectId: field("projectId"), clientId: field("clientId"), orderId: field("orderId"), invoiceId: field("invoiceId") },
      );
      saved.push(doc.id);
    }
    return NextResponse.json({ ok: true, ids: saved });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: "notFound" }, { status: 404 });
    if (e instanceof DocumentError) return NextResponse.json({ error: e.code, saved }, { status: 400 });
    throw e;
  }
}
