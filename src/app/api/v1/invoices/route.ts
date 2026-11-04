import { listInvoices } from "@/server/invoices";
import { handle } from "../handle";

export const runtime = "nodejs";

export function GET(request: Request) {
  const url = new URL(request.url);
  return handle(request, async (ctx) => {
    const { rows, total, pageSize } = await listInvoices(ctx, { q: url.searchParams.get("q") ?? undefined, page: Number(url.searchParams.get("page")) || 1, pageSize: 100 });
    return { data: rows, total, pageSize };
  });
}
