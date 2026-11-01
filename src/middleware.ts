import { NextResponse, type NextRequest } from "next/server";

/**
 * The app needs a session. Only the cookie's presence is checked here — the
 * session itself is verified against the database on every page and action
 * (src/server/request.ts); this just saves an empty round trip.
 */
export function middleware(request: NextRequest) {
  if (!request.cookies.has("erp_session")) {
    const login = new URL("/login", request.url);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*"] };
