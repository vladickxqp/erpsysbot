import { NextResponse } from "next/server";
import { BillingError, handleStripeWebhook } from "@/server/billing";

export const runtime = "nodejs";

/** Stripe calls this; the signature is checked against STRIPE_WEBHOOK_SECRET before anything is changed. */
export async function POST(request: Request) {
  const payload = await request.text();
  try {
    const result = await handleStripeWebhook(payload, request.headers.get("stripe-signature"));
    return NextResponse.json({ received: true, result });
  } catch (e) {
    if (e instanceof BillingError) return NextResponse.json({ error: "billing off" }, { status: 404 });
    console.error("stripe: webhook refused", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
