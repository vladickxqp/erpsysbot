"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { AccountError, authenticate, registerAccount } from "@/server/accounts";
import { SESSION_COOKIE, createSession, deleteSession } from "@/server/auth/sessions";
import { completeChallenge, createChallenge, TwoFactorError, twoFactorEnabled } from "@/server/auth/two-factor";
import { LOCALE_COOKIE, MESSAGES, isLocale, translator } from "@/i18n";
import { sendMail } from "@/server/mail";
import { currentUser, publicBase } from "@/server/request";
import { TeamError, acceptInvitation, passwordTokenForEmail, registerWithInvitation, resetPassword } from "@/server/team";

export type AuthState =
  | {
      error?: "invalid" | "taken" | "tooMany" | "check" | "closed" | "expired" | "wrongEmail" | "region" | "code" | "codeExpired";
      fields?: string[];
      sent?: boolean;
      /** The password was right; the second factor is asked for with this one-time token. */
      challenge?: string;
      /** A challenge that ran out (time or tries). */
      expired?: string;
    }
  | undefined;

async function startSession(userId: string, organizationId: string | null) {
  const h = await headers();
  const { token, expiresAt } = await createSession(userId, organizationId, { userAgent: h.get("user-agent"), ipCountry: await ipCountry() });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

async function clientKey() {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

/** The country Cloudflare saw the request come from; null without Cloudflare in front. */
async function ipCountry(): Promise<string | null> {
  const code = (await headers()).get("cf-ipcountry")?.trim().toUpperCase();
  return code && code !== "XX" ? code : null;
}

/** Only a path inside this app: never another site. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = String(value ?? "");
  if (!next.startsWith("/")) return "/app";
  // Parsed the way a browser does (tabs and backslashes included): it must stay on this site.
  const base = "http://app.invalid";
  const url = new URL(next, base);
  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/app";
}

async function chosenLocale() {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(chosen) ? chosen : "de";
}

export async function loginAction(_: AuthState, form: FormData): Promise<AuthState> {
  try {
    const { userId, organizationId } = await authenticate(
      String(form.get("email") ?? ""),
      String(form.get("password") ?? ""),
      await clientKey(),
      await ipCountry(),
    );
    if (await twoFactorEnabled(userId)) return { challenge: await createChallenge(userId, organizationId) };
    await startSession(userId, organizationId);
  } catch (e) {
    if (e instanceof AccountError) return { error: e.code === "TOO_MANY_ATTEMPTS" ? "tooMany" : e.code === "REGION_BLOCKED" ? "region" : "invalid" };
    throw e;
  }
  redirect(safeNext(form.get("next")));
}

/** The second step: the code from the authenticator app (or a recovery code). */
export async function loginCodeAction(_: AuthState, form: FormData): Promise<AuthState> {
  const challenge = String(form.get("challenge") ?? "");
  try {
    const { userId, organizationId } = await completeChallenge(challenge, String(form.get("code") ?? ""));
    await startSession(userId, organizationId);
  } catch (e) {
    if (e instanceof TwoFactorError) return e.code === "INVALID_CODE" ? { error: "code", challenge } : { error: "codeExpired", expired: challenge };
    throw e;
  }
  redirect(safeNext(form.get("next")));
}

export async function registerAction(_: AuthState, form: FormData): Promise<AuthState> {
  try {
    const { userId, organizationId } = await registerAccount({
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      company: String(form.get("company") ?? ""),
      country: String(form.get("country") ?? ""),
      timezone: String(form.get("timezone") ?? "") || null,
      locale: await chosenLocale(),
    }, String(form.get("invite") ?? "") || null, await ipCountry());
    await startSession(userId, organizationId);
  } catch (e) {
    if (e instanceof AccountError) {
      return { error: e.code === "REGISTRATION_CLOSED" ? "closed" : e.code === "REGION_BLOCKED" ? "region" : "taken" };
    }
    if (e instanceof ZodError) return { error: "check", fields: e.issues.map((i) => String(i.path[0])) };
    throw e;
  }
  redirect("/app");
}

/** Sign-up through an invitation: name and password, the address is the invited one. */
export async function joinAction(_: AuthState, form: FormData): Promise<AuthState> {
  try {
    const { userId, organizationId } = await registerWithInvitation(String(form.get("token") ?? ""), {
      name: String(form.get("name") ?? ""),
      password: String(form.get("password") ?? ""),
      locale: await chosenLocale(),
    });
    await startSession(userId, organizationId);
  } catch (e) {
    if (e instanceof TeamError) return { error: e.code === "EMAIL_TAKEN" ? "taken" : "expired" };
    if (e instanceof ZodError) return { error: "check", fields: e.issues.map((i) => String(i.path[0])) };
    throw e;
  }
  redirect("/app");
}

/** A signed-in person accepts: the company becomes their active one. */
export async function acceptInviteAction(token: string): Promise<AuthState> {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  let organizationId: string;
  try {
    organizationId = await acceptInvitation(token, user);
  } catch (e) {
    if (e instanceof TeamError) return { error: e.code === "WRONG_EMAIL" ? "wrongEmail" : "expired" };
    throw e;
  }
  const jar = await cookies();
  await deleteSession(jar.get(SESSION_COOKIE)?.value);
  await startSession(user.userId, organizationId);
  redirect("/app");
}

/** Always the same answer, whether the address has an account or not. */
export async function forgotAction(_: AuthState, form: FormData): Promise<AuthState> {
  const found = await passwordTokenForEmail(String(form.get("email") ?? ""));
  if (found) {
    const locale = isLocale(found.locale) ? found.locale : "de";
    const t = translator(MESSAGES[locale]);
    const url = `${await publicBase()}/reset/${found.token}`;
    await sendMail({
      to: String(form.get("email")).trim().toLowerCase(),
      subject: t("mail.resetSubject"),
      text: t("mail.resetText", { name: found.name, url }),
    }).catch((e) => console.error("mail: reset failed", e instanceof Error ? e.message : e));
  }
  return { sent: true };
}

export async function resetAction(_: AuthState, form: FormData): Promise<AuthState> {
  try {
    const userId = await resetPassword(String(form.get("token") ?? ""), String(form.get("password") ?? ""));
    // A link from an e-mail is no second factor: with two factors on, sign in again.
    if (await twoFactorEnabled(userId)) redirect("/login");
    await startSession(userId, null);
  } catch (e) {
    if (e instanceof TeamError) return { error: "expired" };
    throw e;
  }
  redirect("/app");
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  await deleteSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
