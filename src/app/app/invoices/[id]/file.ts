import { NotFoundError } from "@/server/clients";
import { InvoiceFileError, keepInvoiceFile } from "@/server/invoice-files";
import type { InvoiceFileKind } from "@/lib/invoicing";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { auditExport } from "@/server/audit";

/** A kept file of an issued invoice as a download. */
export async function fileResponse(id: string, kind: InvoiceFileKind, disposition: "inline" | "attachment"): Promise<Response> {
  const ctx = await requireContext();
  try {
    const file = await keepInvoiceFile(ctx, id, kind);
    await auditExport(ctx, "invoice.download", { invoice: id, kind });
    return new Response(Buffer.from(file.bytes), {
      headers: {
        "Content-Type": kind === "XRECHNUNG" ? "application/xml; charset=utf-8" : file.mimeType,
        "Content-Disposition": `${disposition}; filename="${file.name}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    if (e instanceof InvoiceFileError) return new Response([e.code, ...e.missing].join(" "), { status: e.code === "DAMAGED" ? 500 : 409 });
    throw e;
  }
}
