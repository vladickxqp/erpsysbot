import { NextResponse } from "next/server";
import { handleSupplierEvent } from "@/server/supplier-link";

export const runtime = "nodejs";

/** A supplier's system reports here; nothing is read before its signature fits the supplier's secret. */
export async function POST(request: Request, { params }: { params: Promise<{ supplierId: string }> }) {
  const body = await request.text();
  if (body.length > 1_000_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  try {
    const { status, result } = await handleSupplierEvent((await params).supplierId, body, request.headers.get("x-nexora-timestamp"), request.headers.get("x-nexora-signature"));
    return NextResponse.json({ result }, { status });
  } catch (e) {
    // Anything else: the supplier tries again later.
    console.error("supplier events: failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
