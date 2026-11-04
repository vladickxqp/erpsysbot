/**
 * Workspaces: a company, a creator, a freelancer or one person. The choice
 * sets which modules start on and how the first dashboard looks; both can be
 * changed afterwards. A person may own several workspaces — private data sits
 * in its own workspace and never mixes with a company's.
 */
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { memberships, organizations, sessions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { WORKSPACE_OFF, WORKSPACE_TYPES, withDependents, type WorkspaceType } from "@/lib/modules";
import { audit } from "./audit";
import { startTrial } from "./billing";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

const MAX_OWNED = 10;

export class WorkspaceError extends Error {
  constructor(public readonly code: "TOO_MANY") {
    super(code);
  }
}

export async function chooseWorkspace(ctx: Context, raw: string): Promise<WorkspaceType> {
  requirePermission(ctx.permissions, "settings.manage");
  const type = z.enum(WORKSPACE_TYPES).parse(raw);
  await getDb()
    .update(organizations)
    .set({ workspaceType: type, disabledModules: withDependents(WORKSPACE_OFF[type]) })
    .where(eq(organizations.id, ctx.organization.id));
  await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, "company.workspace", "organization", ctx.organization.id, { type }));
  return type;
}

/** A further workspace of this person: same country and currency, nothing else shared. */
export async function createWorkspace(ctx: Context, rawName: string): Promise<string> {
  const name = z.string().trim().min(1).max(120).parse(rawName);
  const db = getDb();
  const [{ n }] = await db
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.userId, ctx.user.userId), eq(memberships.role, "OWNER")));
  if (Number(n) >= MAX_OWNED) throw new WorkspaceError("TOO_MANY");
  const from = ctx.organization;
  const id = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name,
        locale: from.locale,
        country: from.country,
        currency: from.currency,
        timezone: from.timezone,
        invoiceNumberFormat: from.invoiceNumberFormat,
        quoteNumberFormat: from.quoteNumberFormat,
        creditNoteNumberFormat: from.creditNoteNumberFormat,
      })
      .returning({ id: organizations.id });
    await tx.insert(memberships).values({ organizationId: org.id, userId: ctx.user.userId, role: "OWNER" });
    await tx.update(sessions).set({ activeOrganizationId: org.id }).where(eq(sessions.id, ctx.user.sessionId));
    return org.id;
  });
  await startTrial(id);
  return id;
}
