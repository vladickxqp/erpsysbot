import { PrivacyError, companyExport } from "@/server/privacy";
import { currentContext } from "@/server/request";
import { zipStream } from "@/server/zip";

export const runtime = "nodejs";

/** All of the company's data and files as one ZIP (owners only). */
export async function GET() {
  const ctx = await currentContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const { filename, entries } = await companyExport(ctx);
    return new Response(zipStream(entries), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof PrivacyError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
