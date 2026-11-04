/**
 * Keys for the public API (/api/v1). A key acts for the person who made it,
 * in that company, with that person's rights — and read-only unless it was
 * made writable. Only the hash is stored; the key is shown once.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { apiKeys, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import { contextFor, type Context } from "./context";
import { requirePermission } from "./permissions";
import { isSuspended } from "./platform";

const sha = (token: string) => createHash("sha256").update(token).digest("hex");
const PER_MINUTE = 120;
const hits = new Map<string, number[]>();

export async function listApiKeys(ctx: Context) {
  requirePermission(ctx.permissions, "settings.manage");
  return getDb()
    .select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, writable: apiKeys.writable, lastUsedAt: apiKeys.lastUsedAt, createdAt: apiKeys.createdAt })
    .from(apiKeys)
    .where(eq(apiKeys.organizationId, ctx.organization.id))
    .orderBy(desc(apiKeys.createdAt));
}

export async function createApiKey(ctx: Context, rawName: string, writable: boolean): Promise<string> {
  requirePermission(ctx.permissions, "settings.manage");
  const name = z.string().trim().min(1).max(80).parse(rawName);
  const token = `nx_${randomBytes(32).toString("base64url")}`;
  const [row] = await getDb()
    .insert(apiKeys)
    .values({ organizationId: ctx.organization.id, userId: ctx.user.userId, name, prefix: token.slice(0, 9), tokenHash: sha(token), writable })
    .returning({ id: apiKeys.id });
  await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, "apikey.create", "api_key", row.id, { name, writable }));
  return token;
}

export async function deleteApiKey(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "settings.manage");
  const [row] = await getDb()
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, ctx.organization.id)))
    .returning({ name: apiKeys.name });
  if (!row) throw new NotFoundError();
  await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, "apikey.delete", "api_key", id, { name: row.name }));
}

export type ApiAccess = { ctx: Context } | { status: 401 | 429 };

/** "Authorization: Bearer nx_…" → the context the key acts in. */
export async function apiContext(header: string | null): Promise<ApiAccess> {
  const token = header?.match(/^Bearer\s+(nx_[A-Za-z0-9_-]{20,80})$/)?.[1];
  if (!token) return { status: 401 };
  const db = getDb();
  const [row] = await db.select({ key: apiKeys, user: users }).from(apiKeys).innerJoin(users, eq(users.id, apiKeys.userId)).where(eq(apiKeys.tokenHash, sha(token))).limit(1);
  if (!row || (await isSuspended(row.key.organizationId))) return { status: 401 };
  const { user, key } = row;
  // Counted per real key, so made-up keys cannot fill the memory.
  const recent = (hits.get(key.id) ?? []).filter((t) => Date.now() - t < 60_000);
  if (recent.length >= PER_MINUTE) return { status: 429 };
  hits.set(key.id, [...recent, Date.now()]);
  const ctx = await contextFor({ sessionId: "api", userId: user.id, email: user.email, name: user.name, locale: user.locale, isPlatformAdmin: false, activeOrganizationId: key.organizationId });
  // The person left the company: the key died with the membership.
  if (!ctx || ctx.organization.id !== key.organizationId) return { status: 401 };
  if (!key.writable) for (const p of [...ctx.permissions]) if (!p.endsWith(".read")) ctx.permissions.delete(p);
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  return { ctx };
}
