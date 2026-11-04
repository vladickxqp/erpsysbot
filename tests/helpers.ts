import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { memberships, users } from "@/db/schema";
import { registerAccount } from "@/server/accounts";
import { contextFor, type Context } from "@/server/context";
import type { Role } from "@/server/permissions";

let n = 0;

/** A new user with a new company; the context the server would build for them. */
export async function newCompany(company = "Muster GmbH", country = "DE"): Promise<Context> {
  n += 1;
  const { userId, organizationId } = await registerAccount({
    name: `Owner ${n}`,
    email: `owner${n}-${Date.now()}@example.org`,
    password: "correct horse battery",
    company,
    country,
  });
  await getDb().update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
  return (await contextOf(userId, organizationId))!;
}

/** Another person in an existing company, with the given role. */
export async function newMember(ctx: Context, role: Role, permissions: string[] = []): Promise<Context> {
  n += 1;
  const db = getDb();
  const [user] = await db
    .insert(users)
    .values({ email: `member${n}-${Date.now()}@example.org`, passwordHash: "x", name: `Member ${n}` })
    .returning({ id: users.id });
  await db.insert(memberships).values({ organizationId: ctx.organization.id, userId: user.id, role, permissions });
  return (await contextOf(user.id, ctx.organization.id))!;
}

async function contextOf(userId: string, organizationId: string) {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId));
  return contextFor({
    sessionId: "test",
    userId: user.id,
    email: user.email,
    name: user.name,
    locale: user.locale,
    isPlatformAdmin: false,
    activeOrganizationId: organizationId,
  });
}
