/**
 * Two-factor sign-in with an authenticator app (TOTP, RFC 6238: SHA-1,
 * 6 digits, 30 seconds), plus ten one-time recovery codes.
 *
 * After the password is right, a person with two factors gets a short-lived
 * challenge instead of a session; only a valid code turns it into a session.
 * Each code works once (the last accepted step is kept), a challenge takes
 * five tries in five minutes.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { loginChallenges, sessions, users } from "@/db/schema";

const STEP_SECONDS = 30;
const DIGITS = 6;
const CHALLENGE_MS = 5 * 60_000;
const MAX_TRIES = 5;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export class TwoFactorError extends Error {
  constructor(public readonly code: "INVALID_CODE" | "EXPIRED" | "NOT_SET_UP" | "ALREADY_ON") {
    super(code);
  }
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new TwoFactorError("INVALID_CODE");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** The code of a secret for one 30-second step. */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", Buffer.from(base32Decode(secret))).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const number = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(number).padStart(DIGITS, "0");
}

export const stepOf = (at = Date.now()) => Math.floor(at / 1000 / STEP_SECONDS);

/** The step a code matches (this one, the one before or after), or null. */
export function matchStep(secret: string, code: string, at = Date.now()): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const now = stepOf(at);
  for (const step of [now, now - 1, now + 1]) {
    if (timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(clean))) return step;
  }
  return null;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Wrong codes per person: more than ten in fifteen minutes and every code is refused for a while. */
const FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const failures = new Map<string, number[]>();
const recentFailures = (userId: string) => (failures.get(userId) ?? []).filter((t) => Date.now() - t < FAILURE_WINDOW_MS);
function failed(userId: string): void {
  failures.set(userId, [...recentFailures(userId), Date.now()]);
}

/** For tests: forget wrong codes. */
export function resetTwoFactorThrottle(): void {
  failures.clear();
}
const recoveryHash = (code: string) => sha(code.toLowerCase().replace(/[^a-z0-9]/g, ""));

function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const raw = base32Encode(randomBytes(5)).toLowerCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  });
}

export async function twoFactorEnabled(userId: string): Promise<boolean> {
  const [row] = await getDb().select({ secret: users.totpSecret }).from(users).where(eq(users.id, userId));
  return !!row?.secret;
}

/** A new secret to scan; it counts only after a code confirms it. */
export async function startSetup(userId: string, email: string, issuer = "AI Business OS"): Promise<{ secret: string; uri: string }> {
  if (await twoFactorEnabled(userId)) throw new TwoFactorError("ALREADY_ON");
  const secret = base32Encode(randomBytes(20));
  await getDb().update(users).set({ totpPendingSecret: secret }).where(eq(users.id, userId));
  const label = encodeURIComponent(`${issuer}:${email}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
  return { secret, uri };
}

/** The first code switches two factors on; the recovery codes are shown this once. */
export async function confirmSetup(userId: string, code: string, at = Date.now()): Promise<string[]> {
  const [row] = await getDb().select({ pending: users.totpPendingSecret }).from(users).where(eq(users.id, userId));
  if (!row?.pending) throw new TwoFactorError("NOT_SET_UP");
  const step = matchStep(row.pending, code, at);
  if (step === null) throw new TwoFactorError("INVALID_CODE");
  const codes = newRecoveryCodes();
  await getDb()
    .update(users)
    .set({ totpSecret: row.pending, totpPendingSecret: null, totpLastStep: step, recoveryCodes: codes.map(recoveryHash) })
    .where(eq(users.id, userId));
  return codes;
}

/**
 * Checks a code (or a recovery code, which is then used up) for a person
 * with two factors on. A code of a step already used is refused.
 */
export async function checkSecondFactor(userId: string, code: string, at = Date.now()): Promise<boolean> {
  if (recentFailures(userId).length >= FAILURES) return false;
  const ok = await verifySecondFactor(userId, code, at);
  if (!ok) failed(userId);
  return ok;
}

async function verifySecondFactor(userId: string, code: string, at: number): Promise<boolean> {
  const db = getDb();
  const [row] = await db.select({ secret: users.totpSecret, last: users.totpLastStep }).from(users).where(eq(users.id, userId));
  if (!row?.secret) return false;
  const step = matchStep(row.secret, code, at);
  if (step !== null) {
    if (row.last !== null && step <= row.last) return false;
    const updated = await db
      .update(users)
      .set({ totpLastStep: step })
      .where(and(eq(users.id, userId), row.last === null ? undefined : lt(users.totpLastStep, step)))
      .returning({ id: users.id });
    return updated.length > 0;
  }
  if (!/^[a-z0-9-]{8,9}$/i.test(code.trim())) return false;
  // Taken out in one statement: a recovery code works once, even for two requests at the same time.
  const hashed = recoveryHash(code);
  const used = await db
    .update(users)
    .set({ recoveryCodes: sql`array_remove(${users.recoveryCodes}, ${hashed})` })
    .where(and(eq(users.id, userId), sql`${hashed} = any(${users.recoveryCodes})`))
    .returning({ id: users.id });
  return used.length > 0;
}

/** Switching off needs a valid code: a stolen session alone cannot do it. */
export async function disableTwoFactor(userId: string, code: string): Promise<void> {
  if (!(await checkSecondFactor(userId, code))) throw new TwoFactorError("INVALID_CODE");
  await getDb().update(users).set({ totpSecret: null, totpPendingSecret: null, totpLastStep: null, recoveryCodes: [] }).where(eq(users.id, userId));
}

export async function newRecoveryCodesFor(userId: string, code: string): Promise<string[]> {
  if (!(await checkSecondFactor(userId, code))) throw new TwoFactorError("INVALID_CODE");
  const codes = newRecoveryCodes();
  await getDb().update(users).set({ recoveryCodes: codes.map(recoveryHash) }).where(eq(users.id, userId));
  return codes;
}

export async function recoveryCodesLeft(userId: string): Promise<number> {
  const [row] = await getDb().select({ recovery: users.recoveryCodes }).from(users).where(eq(users.id, userId));
  return row?.recovery.length ?? 0;
}

/** After the password: a one-time token that waits for the second factor. */
export async function createChallenge(userId: string, organizationId: string | null): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const db = getDb();
  await db.delete(loginChallenges).where(lt(loginChallenges.expiresAt, new Date()));
  await db.insert(loginChallenges).values({ userId, organizationId, tokenHash: sha(token), expiresAt: new Date(Date.now() + CHALLENGE_MS) });
  return token;
}

/** The challenge and a code → who signs in; wrong codes use up the tries. */
export async function completeChallenge(token: string, code: string): Promise<{ userId: string; organizationId: string | null }> {
  const db = getDb();
  const [challenge] = await db
    .select()
    .from(loginChallenges)
    .where(and(eq(loginChallenges.tokenHash, sha(token)), gt(loginChallenges.expiresAt, new Date())))
    .limit(1);
  if (!challenge) throw new TwoFactorError("EXPIRED");
  // Count the try before checking it: parallel requests cannot share one try.
  const [counted] = await db
    .update(loginChallenges)
    .set({ attempts: sql`${loginChallenges.attempts} + 1` })
    .where(and(eq(loginChallenges.id, challenge.id), lt(loginChallenges.attempts, MAX_TRIES)))
    .returning({ attempts: loginChallenges.attempts });
  if (!counted) throw new TwoFactorError("EXPIRED");
  if (!(await checkSecondFactor(challenge.userId, code))) throw new TwoFactorError(counted.attempts >= MAX_TRIES ? "EXPIRED" : "INVALID_CODE");
  await db.delete(loginChallenges).where(eq(loginChallenges.id, challenge.id));
  return { userId: challenge.userId, organizationId: challenge.organizationId };
}

// --- Sessions -----------------------------------------------------------------------------------
export async function listSessions(userId: string) {
  return getDb()
    .select({ id: sessions.id, createdAt: sessions.createdAt, userAgent: sessions.userAgent, ipCountry: sessions.ipCountry })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(sessions.createdAt);
}

export async function endSession(userId: string, sessionId: string): Promise<void> {
  await getDb().delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId)));
}

/** Signs out every other device of this person. */
export async function endOtherSessions(userId: string, keepSessionId: string): Promise<void> {
  const db = getDb();
  const all = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  for (const s of all) if (s.id !== keepSessionId) await db.delete(sessions).where(eq(sessions.id, s.id));
}
