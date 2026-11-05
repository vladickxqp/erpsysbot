import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { contextFor, type Context } from "@/server/context";

/** The company of `ctx`, now of the given kind. */
export async function setWorkspace(ctx: Context, workspaceType: string): Promise<Context> {
  await getDb().update(organizations).set({ workspaceType }).where(eq(organizations.id, ctx.organization.id));
  return (await contextFor(ctx.user))!;
}
