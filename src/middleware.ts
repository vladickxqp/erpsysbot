import { NextResponse, type NextRequest } from "next/server";
import { isBlockedCountry } from "@/lib/countries";

// Answered to requests from closed countries (src/lib/countries.ts), on every page.
const CLOSED = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>451</title></head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a">
<main style="text-align:center;padding:16px"><h1 style="font-size:20px">Not available in your region</h1><p>Недоступно в вашем регионе</p></main></body></html>`;

/**
 * Two checks before anything else runs:
 *
 * - Requests from a closed country (Cloudflare's IP country) get 451 on every
 *   page. Webhooks from Telegram and Stripe come from their servers and pass.
 * - The app needs a session. Only the cookie's presence is checked here — the
 *   session itself is verified against the database on every page and action
 *   (src/server/request.ts); this just saves an empty round trip.
 */
export function middleware(request: NextRequest) {
  if (isBlockedCountry(request.headers.get("cf-ipcountry"))) {
    return new NextResponse(CLOSED, { status: 451, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (request.nextUrl.pathname.startsWith("/app") && !request.cookies.has("erp_session")) {
    const login = new URL("/login", request.url);
    return NextResponse.redirect(login);
  }
  // The pages learn their own path from this (src/server/request.ts); a value sent by the browser is replaced.
  const forwarded = new Headers(request.headers);
  forwarded.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: forwarded } });
}

export const config = { matcher: ["/((?!api/telegram|api/stripe|api/health|_next/static|_next/image|favicon.ico).*)"] };
