import { calendarForToken } from "@/server/calendar-feed";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await calendarForToken(token.replace(/\.ics$/, ""));
  if (body === null) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, no-store" } });
}
