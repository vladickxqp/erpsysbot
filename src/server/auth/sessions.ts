/**
 * Logged-in sessions.
 *
 * The browser holds a random token in an HttpOnly cookie; the database holds
 * only its SHA-256, so a copy of the sessions table logs nobody in. Sessions
 * last 30 days and are extended while in use.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sessions, users } from "@/db/schema";

export const SESSION_COOKIE = "erp_session";
export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string, organizationId: string | null, device: { userAgent?: string | null; ipCountry?: string | null } = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await getDb()
    .insert(sessions)
    .values({
      userId,
      tokenHash: digest(token),
      activeOrganizationId: organizationId,
      expiresAt,
      userAgent: device.userAgent?.slice(0, 300) || null,
      ipCountry: device.ipCountry?.slice(0, 2) || null,
    });
  return { token, expiresAt };
}

export type SessionUser = {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  locale: string;
  isPlatformAdmin: boolean;
  activeOrganizationId: string | null;
};

export async function readSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const db = getDb();
  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      activeOrganizationId: sessions.activeOrganizationId,
      userId: users.id,
      email: users.email,
      name: users.name,
      locale: users.locale,
      isPlatformAdmin: users.isPlatformAdmin,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, digest(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Extend a session in use once it is past half its life.
  if (row.expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * DAY_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_DAYS * DAY_MS) })
      .where(eq(sessions.id, row.sessionId));
  }
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    email: row.email,
    name: row.name,
    locale: row.locale,
    isPlatformAdmin: row.isPlatformAdmin,
    activeOrganizationId: row.activeOrganizationId,
  };
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.tokenHash, digest(token)));
}

export async function setActiveOrganization(sessionId: string, organizationId: string): Promise<void> {
  await getDb().update(sessions).set({ activeOrganizationId: organizationId }).where(eq(sessions.id, sessionId));
}
