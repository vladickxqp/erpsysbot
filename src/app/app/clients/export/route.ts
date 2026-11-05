import { auditExport } from "@/server/audit";
import { exportClientsCsv } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export async function GET() {
  const ctx = await requireContext();
  try {
    const csv = await exportClientsCsv(ctx);
    await auditExport(ctx, "client.export");
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="kunden-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
