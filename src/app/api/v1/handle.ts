import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { apiContext } from "@/server/api-keys";
import { DuplicateClientError, NotFoundError } from "@/server/clients";
import type { Context } from "@/server/context";
import { InvoiceFileError } from "@/server/invoice-files";
import { InvoiceStateError } from "@/server/invoices";
import { ForbiddenError } from "@/server/permissions";
import { SendError } from "@/server/send";

/** One way in for every API route: the key, then the work, then plain JSON errors. */
export async function handle(request: Request, work: (ctx: Context) => Promise<unknown>): Promise<Response> {
  const access = await apiContext(request.headers.get("authorization"));
  if ("status" in access) return NextResponse.json({ error: access.status === 429 ? "rate_limited" : "unauthorized" }, { status: access.status });
  try {
    const result = await work(access.ctx);
    return result instanceof Response ? result : NextResponse.json(result);
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "forbidden", permission: e.permission }, { status: 403 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
    if (e instanceof DuplicateClientError) return NextResponse.json({ error: "duplicate" }, { status: 409 });
    if (e instanceof InvoiceStateError || e instanceof InvoiceFileError) return NextResponse.json({ error: e.code, missing: e.missing }, { status: 409 });
    if (e instanceof SendError) return NextResponse.json({ error: e.code }, { status: e.code === "REFUSED" ? 502 : 409 });
    if (e instanceof SyntaxError) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    throw e;
  }
}
