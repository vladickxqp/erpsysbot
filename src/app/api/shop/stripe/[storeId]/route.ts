import { NextResponse } from "next/server";
import { handleShopStripeWebhook, ShopPaymentError } from "@/server/shop-payments";

export const runtime = "nodejs";

/** Stripe calls this for one store; nothing changes before the store's own webhook secret confirms the message. */
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const payload = await request.text();
  try {
    const result = await handleShopStripeWebhook((await params).storeId, payload, request.headers.get("stripe-signature"));
    return NextResponse.json({ received: true, result });
  } catch (e) {
    if (e instanceof ShopPaymentError) {
      return NextResponse.json({ error: e.code === "UNKNOWN" ? "unknown store" : "invalid" }, { status: e.code === "UNKNOWN" ? 404 : 400 });
    }
    // Anything else: Stripe tries again later.
    console.error("shop stripe: webhook failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
