import { getInvoice } from "@/server/invoices";
import { handle } from "../../handle";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(request, async (ctx) => {
    const { invoice, items, payments, clientName } = await getInvoice(ctx, id);
    return { data: { ...invoice, clientName, items, payments } };
  });
}
