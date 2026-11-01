"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { AccountError, authenticate, registerAccount } from "@/server/accounts";
import { SESSION_COOKIE, createSession, deleteSession } from "@/server/auth/sessions";
import { LOCALE_COOKIE, isLocale } from "@/i18n";

export type AuthState = { error?: "invalid" | "taken" | "tooMany" | "check"; fields?: string[] } | undefined;

async function startSession(userId: string, organizationId: string | null) {
  const { token, expiresAt } = await createSession(userId, organizationId);
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

export async function loginAction(_: AuthState, form: FormData): Promise<AuthState> {
  try {
    const { userId, organizationId } = await authenticate(
      String(form.get("email") ?? ""),
      String(form.get("password") ?? ""),
      await clientKey(),
    );
    await startSession(userId, organizationId);
  } catch (e) {
    if (e instanceof AccountError) return { error: e.code === "TOO_MANY_ATTEMPTS" ? "tooMany" : "invalid" };
    throw e;
  }
  redirect("/app");
}

export async function registerAction(_: AuthState, form: FormData): Promise<AuthState> {
  const jar = await cookies();
  const chosen = jar.get(LOCALE_COOKIE)?.value;
  try {
    const { userId, organizationId } = await registerAccount({
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      company: String(form.get("company") ?? ""),
      locale: isLocale(chosen) ? chosen : "de",
    });
    await startSession(userId, organizationId);
  } catch (e) {
    if (e instanceof AccountError) return { error: "taken" };
    if (e instanceof ZodError) return { error: "check", fields: e.issues.map((i) => String(i.path[0])) };
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
