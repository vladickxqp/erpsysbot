/**
 * The request's user and company, for pages and server actions.
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_COOKIE, readSession } from "./auth/sessions";
import { contextFor, type Context } from "./context";
import type { Permission } from "./permissions";
import { appUrl } from "./settings";

export const currentUser = cache(async () => {
  const jar = await cookies();
  return readSession(jar.get(SESSION_COOKIE)?.value);
});

export const currentContext = cache(async (): Promise<Context | null> => {
  const user = await currentUser();
  return user ? contextFor(user) : null;
});

/** The context, or off to the login page. */
export async function requireContext(): Promise<Context> {
  const ctx = await currentContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** For pages of a module: without its permission, back to the overview instead of an error. */
export async function requirePageContext(permission: Permission): Promise<Context> {
  const ctx = await requireContext();
  if (!ctx.permissions.has(permission)) redirect("/app");
  return ctx;
}

/** https://host of this app, for links in e-mails and messages. */
export async function publicBase(): Promise<string> {
  const configured = appUrl();
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
