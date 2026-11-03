import { personalExport } from "@/server/privacy";
import { currentUser } from "@/server/request";

export const runtime = "nodejs";

/** What the app holds about the signed-in person, as JSON. */
export async function GET() {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const data = await personalExport(user);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
