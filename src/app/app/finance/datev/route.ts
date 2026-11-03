import { DatevError, datevExport } from "@/server/datev";
import { ForbiddenError } from "@/server/permissions";
import { activeContext } from "@/server/request";

export const runtime = "nodejs";

/** The DATEV Buchungsstapel of ?from=…&to=… as a file. */
export async function GET(request: Request) {
  const ctx = await activeContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return new Response("Bad request", { status: 400 });
  try {
    const { filename, bytes } = await datevExport(ctx, from, to);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "text/csv; charset=windows-1252",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    if (e instanceof DatevError) return new Response(e.code, { status: 400 });
    throw e;
  }
}
