import { createClient, listClients, type ClientInput } from "@/server/clients";
import { handle } from "../handle";

export const runtime = "nodejs";

export function GET(request: Request) {
  const url = new URL(request.url);
  return handle(request, async (ctx) => {
    const { rows, total, page, pageSize } = await listClients(ctx, { q: url.searchParams.get("q") ?? undefined, page: Number(url.searchParams.get("page")) || 1, pageSize: 100 });
    return { data: rows, total, page, pageSize };
  });
}

export function POST(request: Request) {
  return handle(request, async (ctx) => ({ data: await createClient(ctx, (await request.json()) as ClientInput) }));
}
