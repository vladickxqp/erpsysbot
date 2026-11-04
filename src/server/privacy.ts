/**
 * Data protection (DSGVO/GDPR): everyone takes their own data along, an
 * owner takes the whole company along, and both can be deleted for good.
 *
 * Deleting is final. Issued invoices are deleted with the company too —
 * keeping them for the legal retention period (10 years in Germany) is the
 * company's duty, which is why the company export comes first.
 */
import path from "node:path";
import { rm } from "node:fs/promises";
import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { assistantMessages, documents, goals, habitChecks, habits, memberships, organizations, PRIVATE_TABLES, sessions, TENANT_TABLES, telegramLinks, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { verifyPassword } from "./auth/password";
import { billingEnabled, isActive, subscriptionOf } from "./billing";
import type { Context } from "./context";
import type { SessionUser } from "./auth/sessions";
import { uploadDir } from "./documents";
import type { ZipEntry } from "./zip";

export class PrivacyError extends Error {
  constructor(public readonly code: "OWNER_ONLY" | "WRONG_PASSWORD" | "WRONG_NAME" | "SUBSCRIPTION" | "LAST_OWNER" | "ONLY_MEMBER") {
    super(code);
  }
}

const rowsOf = (result: unknown): Record<string, unknown>[] =>
  Array.isArray(result) ? result : ((result as { rows?: Record<string, unknown>[] }).rows ?? []);

async function checkPassword(userId: string, password: string): Promise<void> {
  const [user] = await getDb().select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!user || !(await verifyPassword(password, user.hash))) throw new PrivacyError("WRONG_PASSWORD");
}

const json = (value: unknown) => JSON.stringify(value, null, 2);
const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 120);

/**
 * Everything of the company, as ZIP entries: its data per table (JSON), the
 * members, and every uploaded file. Owners only.
 */
export async function companyExport(ctx: Context): Promise<{ filename: string; entries: ZipEntry[] }> {
  if (ctx.role !== "OWNER") throw new PrivacyError("OWNER_ONLY");
  const org = ctx.organization;
  const db = getDb();
  const members = await db
    .select({ name: users.name, email: users.email, role: memberships.role, since: memberships.createdAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, org.id));
  const entries: ZipEntry[] = [
    { name: "company.json", data: json(org) },
    { name: "members.json", data: json(members) },
  ];
  // One table after the other: the embedded database has a single connection.
  for (const table of TENANT_TABLES) {
    if (PRIVATE_TABLES.includes(table)) continue;
    const rows = rowsOf(await withTenant(org.id, (tx) => tx.execute(sql`select * from ${sql.identifier(table)}`)));
    if (rows.length) entries.push({ name: `data/${table}.json`, data: json(rows) });
  }
  const files = await withTenant(org.id, (tx) => tx.select({ id: documents.id, name: documents.name, storageKey: documents.storageKey }).from(documents));
  const root = path.resolve(uploadDir());
  for (const f of files) {
    const file = path.resolve(root, f.storageKey);
    if (file.startsWith(root + path.sep)) entries.push({ name: `files/${f.id.slice(0, 8)}-${safeName(f.name)}`, file });
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return { filename: `${safeName(org.name)}-export-${stamp}.zip`, entries };
}

/** What the app holds about one person, across their companies. */
export async function personalExport(user: SessionUser) {
  const db = getDb();
  const [profile] = await db
    .select({ name: users.name, email: users.email, locale: users.locale, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, user.userId));
  const companies = await db
    .select({ id: organizations.id, name: organizations.name, role: memberships.role, since: memberships.createdAt })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, user.userId));
  const devices = await db
    .select({ createdAt: sessions.createdAt, userAgent: sessions.userAgent, ipCountry: sessions.ipCountry })
    .from(sessions)
    .where(eq(sessions.userId, user.userId));
  const telegram = await db.select({ username: telegramLinks.username, createdAt: telegramLinks.createdAt }).from(telegramLinks).where(eq(telegramLinks.userId, user.userId));
  const assistant: Record<string, unknown[]> = {};
  const personal: Record<string, unknown> = {};
  for (const c of companies) {
    assistant[c.name] = await withTenant(c.id, (tx) =>
      tx
        .select({ channel: assistantMessages.channel, role: assistantMessages.role, content: assistantMessages.content, createdAt: assistantMessages.createdAt })
        .from(assistantMessages)
        .where(eq(assistantMessages.userId, user.userId)),
    );
    personal[c.name] = await withTenant(c.id, async (tx) => ({
      goals: await tx.select({ title: goals.title, targetDate: goals.targetDate, progress: goals.progress }).from(goals).where(eq(goals.userId, user.userId)),
      habits: await tx
        .select({ title: habits.title, day: habitChecks.day })
        .from(habits)
        .leftJoin(habitChecks, eq(habitChecks.habitId, habits.id))
        .where(eq(habits.userId, user.userId)),
    }));
  }
  return {
    exportedAt: new Date().toISOString(),
    profile,
    companies: companies.map((c) => ({ name: c.name, role: c.role, since: c.since })),
    sessions: devices,
    telegram,
    assistantConversations: assistant,
    goalsAndHabits: personal,
  };
}

/** Deletes the company with all its data and files. Owner, company name and password. */
export async function deleteCompany(ctx: Context, confirmName: string, password: string): Promise<void> {
  if (ctx.role !== "OWNER") throw new PrivacyError("OWNER_ONLY");
  if (confirmName.trim() !== ctx.organization.name.trim()) throw new PrivacyError("WRONG_NAME");
  await checkPassword(ctx.user.userId, password);
  if (billingEnabled()) {
    const { sub } = await subscriptionOf(ctx.organization.id);
    if (sub?.stripeSubscriptionId && isActive(sub) && !sub.cancelAtPeriodEnd) throw new PrivacyError("SUBSCRIPTION");
  }
  const orgId = ctx.organization.id;
  await getDb().transaction(async (tx) => {
    // Lets the invoice guards (db/rls.sql) delete issued invoices of this one company.
    await tx.execute(sql`select set_config('app.purge_org', ${orgId}, true)`);
    for (const table of [...TENANT_TABLES].reverse()) {
      await tx.execute(sql`delete from ${sql.identifier(table)} where organization_id = ${orgId}`);
    }
    await tx.update(sessions).set({ activeOrganizationId: null }).where(eq(sessions.activeOrganizationId, orgId));
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });
  await rm(path.join(uploadDir(), orgId), { recursive: true, force: true });
}

/**
 * Deletes one's own account. Not while one is the last owner of a company
 * that others still work in (hand it over first), nor while one is the only
 * member of a company (delete the company first).
 */
export async function deleteAccount(user: SessionUser, password: string): Promise<void> {
  await checkPassword(user.userId, password);
  const db = getDb();
  const mine = await db.select({ organizationId: memberships.organizationId, role: memberships.role }).from(memberships).where(eq(memberships.userId, user.userId));
  for (const m of mine) {
    const others = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.organizationId, m.organizationId), ne(memberships.userId, user.userId)));
    if (!others.length) throw new PrivacyError("ONLY_MEMBER");
    if (m.role === "OWNER" && !others.some((o) => o.role === "OWNER")) throw new PrivacyError("LAST_OWNER");
  }
  // Rows that point at the person (sessions, memberships, links, conversations, dashboards) go with them.
  await db.delete(users).where(eq(users.id, user.userId));
}

