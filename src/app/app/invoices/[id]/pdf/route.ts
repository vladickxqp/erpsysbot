import { isLocale } from "@/i18n";
import { NotFoundError } from "@/server/clients";
import { pdfData } from "@/server/invoices";
import { invoicePdf } from "@/server/pdf";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  try {
    const data = await pdfData(ctx, (await params).id);
    const locale = isLocale(ctx.organization.locale) ? ctx.organization.locale : "de";
    const pdf = await invoicePdf({ ...data, locale });
    const name = (data.invoice.number ?? "entwurf").replace(/[^\w.-]+/g, "_");
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${name}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
