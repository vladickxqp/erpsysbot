import { sendInvoice } from "@/server/send";
import { handle } from "../../../handle";

export const runtime = "nodejs";

/** Sends the invoice: { to, message?, format? }. Answers only after the mail server took it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(request, async (ctx) => {
    await sendInvoice(ctx, id, await request.json());
    return { ok: true };
  });
}
