import { issueInvoice } from "@/server/invoices";
import { handle } from "../../../handle";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(request, async (ctx) => ({ data: await issueInvoice(ctx, id) }));
}
