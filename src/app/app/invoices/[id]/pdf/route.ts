import { NotFoundError } from "@/server/clients";
import { pdfData } from "@/server/invoices";
import { renderPdf } from "@/server/invoice-files";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { fileResponse } from "../file";

/** An issued invoice comes from the archive; a draft is drawn as it stands. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  try {
    const data = await pdfData(ctx, id);
    if (data.invoice.status !== "DRAFT") return await fileResponse(id, "PDF", "inline");
    return new Response(Buffer.from(await renderPdf(ctx, data)), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="entwurf.pdf"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
