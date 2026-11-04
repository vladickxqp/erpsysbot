/**
 * The people of a company: members, their roles, invitations.
 *
 * Invitations are one-time links (7 days, only the hash is stored) bound to an
 * e-mail address: whoever accepts must sign in or sign up with exactly that
 * address. Only an OWNER hands out or takes away OWNER, and a company never
 * loses its last OWNER.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { apiKeys, goals, habits, invitations, memberships, organizations, passwordResets, sessions, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { audit } from "./audit";
import { assertSeat } from "./billing";
import { MIN_PASSWORD_LENGTH, hashPassword } from "./auth/password";
import type { Context } from "./context";
import { PERMISSIONS, permissionsFor, requirePermission, ROLE_PERMISSIONS, type Role } from "./permissions";
import { LOCALES } from "@/i18n";

const INVITE_DAYS = 7;
const RESET_MINUTES = 60;
export const ASSIGNABLE_ROLES = ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT", "VIEWER"] as const satisfies readonly Role[];

export class TeamError extends Error {
  constructor(public readonly code: "ALREADY_MEMBER" | "OWNER_ONLY" | "LAST_OWNER" | "NOT_MEMBER" | "INVALID" | "WRONG_EMAIL" | "EMAIL_TAKEN" | "OTHER_COMPANIES") {
    super(code);
  }
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(24).toString("base64url");

export async function listTeam(ctx: Context) {
  requirePermission(ctx.permissions, "employees.read");
  const db = getDb();
  const members = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      permissions: memberships.permissions,
      departmentId: memberships.departmentId,
      since: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, ctx.organization.id))
    .orderBy(asc(memberships.createdAt));
  const pending = ctx.permissions.has("employees.manage")
    ? await db
        .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
        .from(invitations)
        .where(and(eq(invitations.organizationId, ctx.organization.id), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
        .orderBy(asc(invitations.createdAt))
    : [];
  return { members, pending };
}

const inviteInput = z.object({ email: z.string().trim().toLowerCase().email().max(200), role: z.enum(ASSIGNABLE_ROLES) });

/** Nobody hands out a role that holds more than they do themselves. */
function guardRole(ctx: Context, role: Role) {
  if (role === "OWNER" && ctx.role !== "OWNER") throw new TeamError("OWNER_ONLY");
  if (ctx.role !== "OWNER" && ROLE_PERMISSIONS[role].some((p) => !ctx.permissions.has(p))) throw new TeamError("OWNER_ONLY");
}

/** Nobody touches a person who holds more than they do, and only an owner changes themselves. */
async function guardTarget(ctx: Context, userId: string): Promise<void> {
  if (ctx.role === "OWNER") return;
  if (userId === ctx.user.userId) throw new TeamError("OWNER_ONLY");
  const [row] = await getDb()
    .select({ role: memberships.role, permissions: memberships.permissions })
    .from(memberships)
    .where(and(eq(memberships.organizationId, ctx.organization.id), eq(memberships.userId, userId)));
  if (!row) return;
  if ([...permissionsFor(row.role as Role, row.permissions)].some((p) => !ctx.permissions.has(p))) throw new TeamError("OWNER_ONLY");
}

/** Creates (or renews) the invitation for an address; returns the secret token for the link. */
export async function inviteMember(ctx: Context, raw: z.input<typeof inviteInput>): Promise<{ token: string; email: string }> {
  requirePermission(ctx.permissions, "employees.manage");
  const input = inviteInput.parse(raw);
  guardRole(ctx, input.role);
  const db = getDb();
  const [member] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, ctx.organization.id), sql`lower(${users.email}) = ${input.email}`));
  if (member) throw new TeamError("ALREADY_MEMBER");
  const open = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.organizationId, ctx.organization.id), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())));
  await assertSeat(ctx.organization.id, open.length);
  const token = newToken();
  await db.transaction(async (tx) => {
    await tx
      .delete(invitations)
      .where(and(eq(invitations.organizationId, ctx.organization.id), eq(invitations.email, input.email), isNull(invitations.acceptedAt)));
    await tx.insert(invitations).values({
      organizationId: ctx.organization.id,
      email: input.email,
      role: input.role,
      tokenHash: hash(token),
      invitedBy: ctx.user.userId,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    });
  });
  await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, "team.invite", "invitation", null, { email: input.email, role: input.role }));
  return { token, email: input.email };
}

export async function revokeInvitation(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "employees.manage");
  await getDb()
    .delete(invitations)
    .where(and(eq(invitations.id, id), eq(invitations.organizationId, ctx.organization.id), isNull(invitations.acceptedAt)));
}

async function memberRole(organizationId: string, userId: string): Promise<Role | null> {
  const [row] = await getDb()
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)));
  return (row?.role as Role) ?? null;
}

async function ownerCount(organizationId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, "OWNER")));
  return Number(row.n);
}

export async function changeRole(ctx: Context, userId: string, role: Role): Promise<void> {
  requirePermission(ctx.permissions, "employees.manage");
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) throw new TeamError("INVALID");
  const current = await memberRole(ctx.organization.id, userId);
  if (!current) throw new TeamError("NOT_MEMBER");
  if (current === role) return;
  guardRole(ctx, role);
  await guardTarget(ctx, userId);
  if (current === "OWNER") {
    if (ctx.role !== "OWNER") throw new TeamError("OWNER_ONLY");
    if ((await ownerCount(ctx.organization.id)) <= 1) throw new TeamError("LAST_OWNER");
  }
  await getDb()
    .update(memberships)
    // A fixed role is exactly its rights: what a custom one held does not stay behind.
    .set({ role, permissions: [] })
    .where(and(eq(memberships.organizationId, ctx.organization.id), eq(memberships.userId, userId)));
  await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, "team.role", "user", userId, { from: current, to: role }));
}

/**
 * Exactly these rights for one person (role CUSTOM). Nobody hands out what
 * they do not hold themselves; an OWNER is never reduced this way.
 */
export async function setMemberPermissions(ctx: Context, userId: string, wanted: readonly string[]): Promise<void> {
  requirePermission(ctx.permissions, "employees.manage");
  const current = await memberRole(ctx.organization.id, userId);
  if (!current) throw new TeamError("NOT_MEMBER");
  if (current === "OWNER" || userId === ctx.user.userId) throw new TeamError("OWNER_ONLY");
  await guardTarget(ctx, userId);
  const granted = PERMISSIONS.filter((p) => wanted.includes(p) && ctx.permissions.has(p));
  await getDb()
    .update(memberships)
    .set({ role: "CUSTOM", permissions: granted })
    .where(and(eq(memberships.organizationId, ctx.organization.id), eq(memberships.userId, userId)));
  await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, "team.role", "user", userId, { to: "CUSTOM", permissions: granted.length }));
}

export async function removeMember(ctx: Context, userId: string): Promise<void> {
  requirePermission(ctx.permissions, "employees.manage");
  const current = await memberRole(ctx.organization.id, userId);
  if (!current) throw new TeamError("NOT_MEMBER");
  await guardTarget(ctx, userId);
  if (current === "OWNER") {
    if (ctx.role !== "OWNER") throw new TeamError("OWNER_ONLY");
    if ((await ownerCount(ctx.organization.id)) <= 1) throw new TeamError("LAST_OWNER");
  }
  await getDb().delete(memberships).where(and(eq(memberships.organizationId, ctx.organization.id), eq(memberships.userId, userId)));
  // One's own goals and habits leave with the person.
  await withTenant(ctx.organization.id, async (tx) => {
    await tx.delete(goals).where(eq(goals.userId, userId));
    await tx.delete(habits).where(eq(habits.userId, userId));
  });
  await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, "team.remove", "user", userId, { role: current }));
}

// --- Accepting an invitation ------------------------------------------------------------------

export type OpenInvitation = { id: string; organizationId: string; company: string; email: string; role: Role };

export async function findInvitation(token: string): Promise<OpenInvitation | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [row] = await getDb()
    .select({ id: invitations.id, organizationId: invitations.organizationId, company: organizations.name, email: invitations.email, role: invitations.role })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .where(and(eq(invitations.tokenHash, hash(token)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())));
  return row ? { ...row, role: row.role as Role } : null;
}

/** A signed-in user joins: their e-mail must be the invited one. */
export async function acceptInvitation(token: string, user: { userId: string; email: string }): Promise<string> {
  const invite = await findInvitation(token);
  if (!invite) throw new TeamError("INVALID");
  if (invite.email !== user.email.toLowerCase()) throw new TeamError("WRONG_EMAIL");
  await getDb().transaction(async (tx) => {
    await tx
      .insert(memberships)
      .values({ organizationId: invite.organizationId, userId: user.userId, role: invite.role })
      .onConflictDoNothing();
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invite.id));
  });
  return invite.organizationId;
}

const joinInput = z.object({
  name: z.string().trim().min(2).max(100),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  locale: z.enum(LOCALES).default("de"),
});

/** A new person signs up through the invitation, with the invited address. */
export async function registerWithInvitation(token: string, raw: z.input<typeof joinInput>): Promise<{ userId: string; organizationId: string }> {
  const input = joinInput.parse(raw);
  const invite = await findInvitation(token);
  if (!invite) throw new TeamError("INVALID");
  const passwordHash = await hashPassword(input.password);
  return getDb().transaction(async (tx) => {
    const [taken] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${invite.email}`);
    if (taken) throw new TeamError("EMAIL_TAKEN");
    const [user] = await tx
      .insert(users)
      .values({ email: invite.email, passwordHash, name: input.name, locale: input.locale })
      .returning({ id: users.id });
    await tx.insert(memberships).values({ organizationId: invite.organizationId, userId: user.id, role: invite.role });
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invite.id));
    return { userId: user.id, organizationId: invite.organizationId };
  });
}

// --- Password links ---------------------------------------------------------------------------

export async function createPasswordToken(userId: string): Promise<string> {
  const token = newToken();
  const db = getDb();
  await db.delete(passwordResets).where(eq(passwordResets.userId, userId));
  await db.insert(passwordResets).values({ tokenHash: hash(token), userId, expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) });
  return token;
}

/** For "forgot password": a token for the address, or null when nobody has it. */
export async function passwordTokenForEmail(email: string): Promise<{ token: string; name: string; locale: string } | null> {
  const address = z.string().trim().toLowerCase().email().safeParse(email);
  if (!address.success) return null;
  const [user] = await getDb().select().from(users).where(sql`lower(${users.email}) = ${address.data}`);
  if (!user) return null;
  return { token: await createPasswordToken(user.id), name: user.name, locale: user.locale };
}

/**
 * An admin hands a member a password link (when no e-mail is set up). Not for
 * OWNERs unless by an OWNER — and only for people who belong to this company
 * alone: a password opens every company of a person, which no single
 * company's admin may hand out (nor the platform admin's).
 */
export async function passwordLinkForMember(ctx: Context, userId: string): Promise<string> {
  requirePermission(ctx.permissions, "employees.manage");
  const role = await memberRole(ctx.organization.id, userId);
  if (!role) throw new TeamError("NOT_MEMBER");
  if (role === "OWNER" && ctx.role !== "OWNER") throw new TeamError("OWNER_ONLY");
  await guardTarget(ctx, userId);
  const [target] = await getDb().select({ admin: users.isPlatformAdmin }).from(users).where(eq(users.id, userId));
  const elsewhere = await getDb()
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), ne(memberships.organizationId, ctx.organization.id)))
    .limit(1);
  if (target?.admin || elsewhere.length) throw new TeamError("OTHER_COMPANIES");
  await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, "team.password_link", "user", userId));
  return createPasswordToken(userId);
}

export async function passwordTokenValid(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  const [row] = await getDb()
    .select({ userId: passwordResets.userId })
    .from(passwordResets)
    .where(and(eq(passwordResets.tokenHash, hash(token)), gt(passwordResets.expiresAt, new Date())));
  return !!row;
}

/** Sets the new password, ends every session of that person, uses the link up. */
export async function resetPassword(token: string, password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) throw new TeamError("INVALID");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new TeamError("INVALID");
  const passwordHash = await hashPassword(password);
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .delete(passwordResets)
      .where(and(eq(passwordResets.tokenHash, hash(token)), gt(passwordResets.expiresAt, new Date())))
      .returning();
    if (!row) throw new TeamError("INVALID");
    await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
    await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    await tx.delete(passwordResets).where(eq(passwordResets.userId, row.userId));
    // A reset may follow a stolen account: keys made meanwhile must not survive it.
    await tx.delete(apiKeys).where(eq(apiKeys.userId, row.userId));
    return row.userId;
  });
}

export async function accountExists(email: string): Promise<boolean> {
  const [row] = await getDb().select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  return !!row;
}

/** Names of everyone in the company, for "assigned to" fields (no extra permission). */
export async function memberOptions(ctx: Context): Promise<{ id: string; name: string }[]> {
  return getDb()
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, ctx.organization.id))
    .orderBy(asc(users.name));
}
