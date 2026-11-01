/**
 * Signing up and signing in.
 *
 * Signing up creates the person, their company and their OWNER membership in
 * one transaction: there is never a user without a company or a company
 * without an owner. Signing in answers "wrong email or password" for both
 * cases and takes the same time either way, so it does not reveal which
 * emails have an account.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { memberships, organizations, users } from "@/db/schema";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "./auth/password";

export const LOCALES = ["de", "en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];

const email = z.string().trim().toLowerCase().email().max(200);

export const registerInput = z.object({
  name: z.string().trim().min(2).max(100),
  email,
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  company: z.string().trim().min(2).max(120),
  locale: z.enum(LOCALES).default("de"),
});
export type RegisterInput = z.input<typeof registerInput>;

export class AccountError extends Error {
  constructor(public readonly code: "EMAIL_TAKEN" | "INVALID_LOGIN" | "TOO_MANY_ATTEMPTS") {
    super(code);
  }
}

export async function registerAccount(raw: RegisterInput) {
  const input = registerInput.parse(raw);
  const passwordHash = await hashPassword(input.password);
  return getDb().transaction(async (tx) => {
    const taken = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`)
      .limit(1);
    if (taken.length) throw new AccountError("EMAIL_TAKEN");
    const [user] = await tx
      .insert(users)
      .values({ email: input.email, passwordHash, name: input.name, locale: input.locale })
      .returning({ id: users.id });
    const [org] = await tx
      .insert(organizations)
      .values({ name: input.company, locale: input.locale })
      .returning({ id: organizations.id });
    await tx.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "OWNER" });
    return { userId: user.id, organizationId: org.id };
  });
}

// --- Signing in -------------------------------------------------------------------------------
const ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, number[]>();
// Compared against when the email is unknown, so both paths cost one scrypt.
let decoy: string | null = null;

function throttled(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  attempts.set(key, recent);
  return recent.length >= ATTEMPTS;
}

function remember(key: string): void {
  attempts.set(key, [...(attempts.get(key) ?? []), Date.now()]);
}

export async function authenticate(rawEmail: string, password: string, client = "?") {
  const address = email.safeParse(rawEmail);
  const key = `${client}|${address.success ? address.data : rawEmail}`;
  if (throttled(key)) throw new AccountError("TOO_MANY_ATTEMPTS");
  const db = getDb();
  const [user] = address.success
    ? await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${address.data}`)
        .limit(1)
    : [];
  decoy ??= await hashPassword("decoy-password-for-timing");
  const ok = await verifyPassword(password, user?.passwordHash ?? decoy);
  if (!user || !ok) {
    remember(key);
    throw new AccountError("INVALID_LOGIN");
  }
  attempts.delete(key);
  const [first] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .orderBy(memberships.createdAt)
    .limit(1);
  return { userId: user.id, organizationId: first?.organizationId ?? null };
}

export async function membershipOf(userId: string, organizationId: string) {
  const [row] = await getDb()
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/** For tests: forget every failed attempt. */
export function resetThrottle(): void {
  attempts.clear();
}
