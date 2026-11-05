import { NextResponse } from "next/server";
import { inbox, unreadCount } from "@/server/inbox";
import { activeContext } from "@/server/request";

export const runtime = "nodejs";

/** What needs attention now, for the bell: the first lines of the inbox. */
export async function GET() {
  const ctx = await activeContext();
  if (!ctx) return NextResponse.json({ error: "auth" }, { status: 401 });
  const items = await inbox(ctx);
  return NextResponse.json(
    { count: unreadCount(items), items: items.filter((i) => !i.read).slice(0, 6).map(({ id, kind, vars, href, insight }) => ({ id, kind, vars, href, insightKey: insight?.key })) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
