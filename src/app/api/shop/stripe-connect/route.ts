import { NextResponse } from "next/server";
import { handleConnectWebhook, ShopPaymentError } from "@/server/shop-payments";

export const runtime = "nodejs";

/** Stripe calls this for every connected shop; nothing changes before the platform's Connect secret confirms the message. */
export async function POST(request: Request) {
  const payload = await request.text();
  try {
    const result = await handleConnectWebhook(payload, request.headers.get("stripe-signature"));
    return NextResponse.json({ received: true, result });
  } catch (e) {
    if (e instanceof ShopPaymentError) {
      return NextResponse.json({ error: e.code === "UNKNOWN" ? "connect off" : "invalid" }, { status: e.code === "UNKNOWN" ? 404 : 400 });
    }
    // Anything else: Stripe tries again later.
    console.error("stripe connect: webhook failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
