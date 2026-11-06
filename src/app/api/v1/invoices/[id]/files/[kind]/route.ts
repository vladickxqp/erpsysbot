import { NextResponse } from "next/server";
import { INVOICE_FILE_KINDS, type InvoiceFileKind } from "@/lib/invoicing";
import { keepInvoiceFile } from "@/server/invoice-files";
import { handle } from "../../../../handle";

export const runtime = "nodejs";

/** A kept file of an issued invoice: PDF, ZUGFERD or XRECHNUNG. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  const wanted = kind.toUpperCase();
  if (!(INVOICE_FILE_KINDS as readonly string[]).includes(wanted)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return handle(request, async (ctx) => {
    const file = await keepInvoiceFile(ctx, id, wanted as InvoiceFileKind);
    return new Response(Buffer.from(file.bytes), {
      headers: { "Content-Type": file.mimeType, "Content-Disposition": `attachment; filename="${file.name}"`, "Cache-Control": "no-store" },
    });
  });
}
