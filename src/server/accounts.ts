/**
 * Signing up and signing in.
 *
 * Signing up creates the person, their company and their OWNER membership in
 * one transaction: there is never a user without a company or a company
 * without an owner. Signing in answers "wrong email or password" for both
 * cases and takes the same time either way, so it does not reveal which
 * emails have an account.
 *
 * The company's country is chosen at sign-up and sets its currency, tax and
 * numbering (src/lib/countries.ts). Where the request comes from (Cloudflare's
 * IP country) is checked against it: Russia, Belarus and Tor are refused, and
 * a company whose country differs from where it signed up waits for the
 * platform admin's review before anyone can work in it.
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { memberships, organizations, platformInvites, sessions, suspensions, users } from "@/db/schema";
import { LOCALES } from "@/i18n";
import { countryProfile, isBlockedCountry, isCountry } from "@/lib/countries";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "./auth/password";
import { startTrial } from "./billing";
import { findPlatformInvite } from "./platform";
import { registrationOpen } from "./settings";

const email = z.string().trim().toLowerCase().email().max(200);

export const registerInput = z.object({
  name: z.string().trim().min(2).max(100),
  email,
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  company: z.string().trim().min(2).max(120),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((c) => isCountry(c) && !isBlockedCountry(c), "country"),
  /** The browser's time zone; the country's when it is none we know. */
  timezone: z.string().trim().max(60).nullish(),
  locale: z.enum(LOCALES).default("de"),
});
export type RegisterInput = z.input<typeof registerInput>;

export class AccountError extends Error {
  constructor(public readonly code: "EMAIL_TAKEN" | "INVALID_LOGIN" | "TOO_MANY_ATTEMPTS" | "REGISTRATION_CLOSED" | "REGION_BLOCKED") {
    super(code);
  }
}

/** Signing up with a new company: open to all, or only the first account on an empty server. */
export async function registrationAllowed(): Promise<boolean> {
  if (registrationOpen()) return true;
  const [any] = await getDb().select({ id: users.id }).from(users).limit(1);
  return !any;
}

/** Tor exit nodes (Cloudflare reports them as T1) and closed countries may not sign up or sign in. */
export function regionRefused(ipCountry: string | null | undefined): boolean {
  return ipCountry === "T1" || isBlockedCountry(ipCountry);
}

function validTimezone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Signs up a person with a new company: open sign-up, the first account, or an
 * invitation from the platform admin. `ipCountry` is where the request came
 * from (null when unknown, e.g. without Cloudflare in front).
 */
export async function registerAccount(raw: RegisterInput, inviteToken?: string | null, ipCountry?: string | null) {
  if (regionRefused(ipCountry)) throw new AccountError("REGION_BLOCKED");
  const input = registerInput.parse(raw);
  const found = inviteToken ? await findPlatformInvite(inviteToken) : null;
  // An invitation is for its address only; with another one it counts as none.
  const invite = found && found.email.trim().toLowerCase() === input.email ? found : null;
  if (!invite && !(await registrationAllowed())) throw new AccountError("REGISTRATION_CLOSED");
  const profile = countryProfile(input.country);
  const passwordHash = await hashPassword(input.password);
  const created = await getDb().transaction(async (tx) => {
    // The first account on the server administers the platform.
    const [anyone] = await tx.select({ id: users.id }).from(users).limit(1);
    const taken = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`)
      .limit(1);
    if (taken.length) throw new AccountError("EMAIL_TAKEN");
    // Claimed in the same transaction: one invitation, one company — even for two requests at once.
    if (invite) {
      const claimed = await tx
        .update(platformInvites)
        .set({ usedAt: new Date() })
        .where(and(eq(platformInvites.id, invite.id), isNull(platformInvites.usedAt)))
        .returning({ id: platformInvites.id });
      if (!claimed.length) throw new AccountError("REGISTRATION_CLOSED");
    }
    const [user] = await tx
      .insert(users)
      .values({ email: input.email, passwordHash, name: input.name, locale: input.locale, isPlatformAdmin: !anyone })
      .returning({ id: users.id });
    const [org] = await tx
      .insert(organizations)
      .values({
        name: input.company,
        locale: input.locale,
        country: profile.code,
        currency: profile.currency,
        timezone: validTimezone(input.timezone) ? input.timezone : profile.timezone,
        smallBusiness: false,
        invoiceNumberFormat: profile.numbers.invoice,
        quoteNumberFormat: profile.numbers.quote,
        creditNoteNumberFormat: profile.numbers.creditNote,
        signupIpCountry: ipCountry ?? null,
      })
      .returning({ id: organizations.id });
    await tx.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "OWNER" });
    // Signed up from somewhere else than the company's country: the admin looks first.
    // Not for the platform's own first account, nor for a company the admin invited.
    if (anyone && !invite && ipCountry && ipCountry !== profile.code) {
      await tx.insert(suspensions).values({ organizationId: org.id, kind: "REVIEW", reason: `${ipCountry} → ${profile.code}` });
    }
    return { userId: user.id, organizationId: org.id };
  });
  await startTrial(created.organizationId);
  return created;
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

export async function authenticate(rawEmail: string, password: string, client = "?", ipCountry: string | null = null) {
  if (regionRefused(ipCountry)) throw new AccountError("REGION_BLOCKED");
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

/** The person's own password, asked again before sensitive changes. */
export async function passwordMatches(userId: string, password: string): Promise<boolean> {
  const [user] = await getDb().select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
  return !!user && (await verifyPassword(password, user.hash));
}

export class PasswordChangeError extends Error {
  constructor(public readonly code: "WRONG_PASSWORD" | "TOO_SHORT") {
    super(code);
  }
}

/** Changes one's own password; every other device has to sign in again. */
export async function changePassword(userId: string, sessionId: string, current: string, next: string): Promise<void> {
  if (next.length < MIN_PASSWORD_LENGTH || next.length > 200) throw new PasswordChangeError("TOO_SHORT");
  if (!(await passwordMatches(userId, current))) throw new PasswordChangeError("WRONG_PASSWORD");
  const passwordHash = await hashPassword(next);
  await getDb().transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    await tx.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, sessionId)));
  });
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
