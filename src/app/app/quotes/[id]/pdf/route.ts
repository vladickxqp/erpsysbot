import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { renderQuote } from "@/server/send";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  try {
    const doc = await renderQuote(ctx, (await params).id);
    return new Response(Buffer.from(doc.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${doc.number.replace(/[^\w.-]+/g, "_")}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
