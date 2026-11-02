import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { XRechnungError, xrechnungXml } from "@/server/xrechnung";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  try {
    const { xml, number } = await xrechnungXml(ctx, (await params).id);
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${number.replace(/[^\w.-]+/g, "_")}_xrechnung.xml"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    if (e instanceof XRechnungError) return new Response(e.code, { status: 409 });
    throw e;
  }
}
