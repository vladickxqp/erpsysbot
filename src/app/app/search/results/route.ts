import { NextResponse } from "next/server";
import { activeContext } from "@/server/request";
import { SEARCH_KINDS, searchSmart, type SearchKind } from "@/server/search";

export const runtime = "nodejs";

/** The search behind the command palette: a few hits per kind, for the signed-in person. */
export async function GET(request: Request) {
  const ctx = await activeContext();
  if (!ctx) return NextResponse.json({ error: "auth" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const result = await searchSmart(ctx, params.get("q") ?? "", {
    limit: 5,
    kinds: (SEARCH_KINDS as readonly string[]).includes(kind ?? "") ? [kind as SearchKind] : undefined,
    offset: Number(params.get("offset")) || 0,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
