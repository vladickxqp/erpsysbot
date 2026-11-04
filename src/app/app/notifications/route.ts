import { NextResponse } from "next/server";
import { activeContext } from "@/server/request";
import { loadWidgetData } from "@/server/widget-data";

export const runtime = "nodejs";

/** What needs attention now, for the bell. Worked out from the modules, nothing stored. */
export async function GET() {
  const ctx = await activeContext();
  if (!ctx) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { notifications } = await loadWidgetData(ctx, new Set(["notifications"]));
  return NextResponse.json({ items: notifications ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}
