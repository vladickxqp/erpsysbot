/**
 * Proving an e-mail address: a one-time link, 48 hours. Unproven people can
 * work, but on a server with open sign-up they cannot send mail to others —
 * the sender address is shared by everyone.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { emailVerifications, users } from "@/db/schema";
import { MESSAGES, translator, type Locale } from "@/i18n";
import { mailAvailable, sendMail } from "../mail";

const VALID_MS = 48 * 60 * 60_000;
const sha = (token: string) => createHash("sha256").update(token).digest("hex");

export async function emailVerified(userId: string): Promise<boolean> {
  const [row] = await getDb().select({ at: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
  return !!row?.at;
}

/** A new link; the earlier ones of this person stop working. */
export async function createVerificationToken(userId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const db = getDb();
  await db.delete(emailVerifications).where(eq(emailVerifications.userId, userId));
  await db.delete(emailVerifications).where(lt(emailVerifications.expiresAt, new Date()));
  await db.insert(emailVerifications).values({ userId, tokenHash: sha(token), expiresAt: new Date(Date.now() + VALID_MS) });
  return token;
}

/** Mails the link. Without e-mail on this server there is nothing to prove the address with. */
export async function sendVerificationMail(userId: string, to: string, locale: Locale, base: string): Promise<boolean> {
  if (!mailAvailable()) return false;
  const t = translator(MESSAGES[locale]);
  const url = `${base}/verify/${await createVerificationToken(userId)}`;
  return sendMail({ to, subject: t("mail.verifySubject"), text: t("mail.verifyText", { url }) }).catch((e) => {
    console.error("mail: verification failed", e instanceof Error ? e.message : e);
    return false;
  });
}

/** Redeems a link; false when it is unknown, used or too old. */
export async function verifyEmail(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  const db = getDb();
  const [row] = await db
    .delete(emailVerifications)
    .where(and(eq(emailVerifications.tokenHash, sha(token)), gt(emailVerifications.expiresAt, new Date())))
    .returning({ userId: emailVerifications.userId });
  if (!row) return false;
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
  return true;
}
