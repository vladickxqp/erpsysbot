import { createInvoiceDraft, listInvoices, type InvoiceInput } from "@/server/invoices";
import { handle } from "../handle";

export const runtime = "nodejs";

export function GET(request: Request) {
  const url = new URL(request.url);
  return handle(request, async (ctx) => {
    const { rows, total, pageSize } = await listInvoices(ctx, { q: url.searchParams.get("q") ?? undefined, page: Number(url.searchParams.get("page")) || 1, pageSize: 100 });
    return { data: rows, total, pageSize };
  });
}

/** A new draft; the same Idempotency-Key twice stays one invoice. */
export function POST(request: Request) {
  return handle(request, async (ctx) => {
    const body = (await request.json()) as InvoiceInput;
    const invoice = await createInvoiceDraft(ctx, { ...body, requestId: request.headers.get("idempotency-key") ?? undefined });
    return { data: invoice };
  });
}
