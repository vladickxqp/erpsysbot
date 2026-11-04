import { createTask, listTasks, type TaskInput } from "@/server/tasks";
import { handle } from "../handle";

export const runtime = "nodejs";

export function GET(request: Request) {
  const url = new URL(request.url);
  return handle(request, async (ctx) => ({ data: await listTasks(ctx, { q: url.searchParams.get("q") ?? undefined, open: url.searchParams.get("open") === "1" }) }));
}

export function POST(request: Request) {
  return handle(request, async (ctx) => ({ data: await createTask(ctx, (await request.json()) as TaskInput) }));
}
