import { exportTransactionsCsv } from "@/server/finance";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const ctx = await requireContext();
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  try {
    const csv = await exportTransactionsCsv(ctx, from && DATE.test(from) ? from : undefined, to && DATE.test(to) ? to : undefined);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="finanzen-${from ?? "alle"}-${to ?? ""}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
