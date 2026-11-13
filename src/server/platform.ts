/**
 * The platform administration (super admin): every company at a glance,
 * invitations for new companies (sign-up is invite-only), suspending a
 * company, plans and their limits. Only users with is_platform_admin.
 * Reads across companies on purpose — never through withTenant.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { assistantMessages, auditLog, invoices, memberships, organizations, plans, platformInvites, sessions, subscriptions, suspensions, users } from "@/db/schema";
import { AREAS } from "@/lib/areas";
import { countryProfile, isBlockedCountry, isCountry } from "@/lib/countries";
import type { SessionUser } from "./auth/sessions";

export class PlatformError extends Error {
  constructor(public readonly code: "NOT_ADMIN" | "INVALID") {
    super(code);
  }
}

export function requirePlatformAdmin(user: Pick<SessionUser, "isPlatformAdmin">): void {
  if (!user.isPlatformAdmin) throw new PlatformError("NOT_ADMIN");
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const DAY = 86_400_000;

export async function platformStats(user: SessionUser) {
  requirePlatformAdmin(user);
  const db = getDb();
  const since30 = new Date(Date.now() - 30 * DAY);
  const since7 = new Date(Date.now() - 7 * DAY);
  const since1 = new Date(Date.now() - DAY);
  const [companies] = await db
    .select({ total: sql<number>`count(*)::int`, recent: sql<number>`count(*) filter (where ${organizations.createdAt} >= ${since30.toISOString()})::int` })
    .from(organizations);
  const [people] = await db.select({ total: sql<number>`count(*)::int` }).from(users);
  const [active] = await db.select({ n: sql<number>`count(distinct ${sessions.userId})::int` }).from(sessions).where(gte(sessions.createdAt, since7));
  const [ai] = await db
    .select({
      day: sql<number>`count(*) filter (where ${assistantMessages.role} = 'user' and ${assistantMessages.createdAt} >= ${since1.toISOString()})::int`,
      month: sql<number>`count(*) filter (where ${assistantMessages.role} = 'user')::int`,
      input: sql<number>`coalesce(sum(${assistantMessages.inputTokens}), 0)::bigint`,
      output: sql<number>`coalesce(sum(${assistantMessages.outputTokens}), 0)::bigint`,
    })
    .from(assistantMessages)
    .where(gte(assistantMessages.createdAt, since30));
  const byStatus = await db.select({ status: subscriptions.status, plan: subscriptions.planId, n: sql<number>`count(*)::int` }).from(subscriptions).groupBy(subscriptions.status, subscriptions.planId);
  const started = Date.now();
  await db.execute(sql`select 1`);
  return {
    companies: Number(companies.total),
    newCompanies30: Number(companies.recent),
    users: Number(people.total),
    activeUsers7: Number(active.n),
    aiDay: Number(ai.day),
    aiMonth: Number(ai.month),
    tokensIn30: Number(ai.input),
    tokensOut30: Number(ai.output),
    subscriptions: byStatus.map((s) => ({ status: s.status, plan: s.plan, count: Number(s.n) })),
    dbMillis: Date.now() - started,
    uptimeSeconds: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };
}

export async function listCompanies(user: SessionUser) {
  requirePlatformAdmin(user);
  const db = getDb();
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      createdAt: organizations.createdAt,
      country: organizations.country,
      signupIpCountry: organizations.signupIpCountry,
      members: sql<number>`(select count(*)::int from ${memberships} m where m.organization_id = organizations.id)`,
      lastActivity: sql<string | null>`(select max(a.created_at)::text from ${auditLog} a where a.organization_id = ${organizations.id})`,
      planId: subscriptions.planId,
      status: subscriptions.status,
      trialEndsAt: subscriptions.trialEndsAt,
      suspended: sql<boolean>`${suspensions.organizationId} is not null`,
      suspensionKind: suspensions.kind,
    })
    .from(organizations)
    .leftJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
    .leftJoin(suspensions, eq(suspensions.organizationId, organizations.id))
    .orderBy(desc(organizations.createdAt))
    .limit(500);
  return rows.map((r) => ({ ...r, members: Number(r.members) }));
}

export async function setSuspended(user: SessionUser, organizationId: string, suspended: boolean, reason?: string) {
  requirePlatformAdmin(user);
  const db = getDb();
  if (suspended) await db.insert(suspensions).values({ organizationId, reason: reason ?? null }).onConflictDoNothing();
  else await db.delete(suspensions).where(eq(suspensions.organizationId, organizationId));
}

export async function isSuspended(organizationId: string): Promise<boolean> {
  return (await suspensionOf(organizationId)) !== null;
}

/** SUSPENDED, REVIEW (waiting for the admin after sign-up) or null. */
export async function suspensionOf(organizationId: string): Promise<string | null> {
  const [row] = await getDb().select({ kind: suspensions.kind }).from(suspensions).where(eq(suspensions.organizationId, organizationId));
  return row?.kind ?? null;
}

/**
 * Corrects a company's country. Its currency follows only while it has issued
 * no invoice yet — figures already issued keep theirs. Its tax rates go back
 * to the new country's.
 */
export async function setCompanyCountry(user: SessionUser, organizationId: string, country: string) {
  requirePlatformAdmin(user);
  const code = country.trim().toUpperCase();
  if (!isCountry(code) || isBlockedCountry(code)) throw new PlatformError("INVALID");
  const db = getDb();
  const [issued] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), sql`${invoices.status} <> 'DRAFT'`))
    .limit(1);
  const profile = countryProfile(code);
  await db
    .update(organizations)
    .set({ country: code, taxRates: null, ...(issued ? {} : { currency: profile.currency }) })
    .where(eq(organizations.id, organizationId));
}

// --- Invitations for new companies -----------------------------------------------------------

export async function invitePlatform(user: SessionUser, email: string): Promise<string> {
  requirePlatformAdmin(user);
  const address = z.string().trim().toLowerCase().email().max(200).parse(email);
  const token = randomBytes(24).toString("base64url");
  await getDb().insert(platformInvites).values({ email: address, tokenHash: hash(token), createdBy: user.userId, expiresAt: new Date(Date.now() + 14 * DAY) });
  return token;
}

export async function findPlatformInvite(token: string): Promise<{ id: string; email: string } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [row] = await getDb()
    .select({ id: platformInvites.id, email: platformInvites.email })
    .from(platformInvites)
    .where(and(eq(platformInvites.tokenHash, hash(token)), isNull(platformInvites.usedAt), gt(platformInvites.expiresAt, new Date())));
  return row ?? null;
}

export async function openPlatformInvites(user: SessionUser) {
  requirePlatformAdmin(user);
  return getDb()
    .select({ id: platformInvites.id, email: platformInvites.email, expiresAt: platformInvites.expiresAt })
    .from(platformInvites)
    .where(and(isNull(platformInvites.usedAt), gt(platformInvites.expiresAt, new Date())))
    .orderBy(desc(platformInvites.createdAt));
}

// --- Plans ------------------------------------------------------------------------------------

export const planInput = z.object({
  name: z.string().trim().min(1).max(60),
  priceCents: z.coerce.number().int().min(0).max(1_000_000),
  maxUsers: z.coerce.number().int().min(1).max(10_000),
  aiPerDay: z.coerce.number().int().min(0).max(100_000),
  modules: z.array(z.string().trim().min(1).max(30)).max(40),
  areas: z.array(z.enum(AREAS)).max(AREAS.length).default([]),
  stripePriceId: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((v) => v || null),
  active: z.boolean().default(true),
});

export async function listPlans() {
  return getDb().select().from(plans).orderBy(asc(plans.position));
}

export async function updatePlan(user: SessionUser, id: string, raw: z.input<typeof planInput>) {
  requirePlatformAdmin(user);
  const input = planInput.parse(raw);
  const [row] = await getDb().update(plans).set(input).where(eq(plans.id, id)).returning();
  if (!row) throw new PlatformError("INVALID");
  return row;
}

/** By hand, e.g. for a customer who pays by bank transfer. */
export async function setCompanyPlan(user: SessionUser, organizationId: string, planId: string, status: "ACTIVE" | "TRIALING" | "CANCELED") {
  requirePlatformAdmin(user);
  await getDb()
    .insert(subscriptions)
    .values({ organizationId, planId, status })
    .onConflictDoUpdate({ target: subscriptions.organizationId, set: { planId, status, updatedAt: new Date() } });
}
