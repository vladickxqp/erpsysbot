import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/** For Docker and the uptime check: the app answers and the database too. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}

export const dynamic = "force-dynamic";
