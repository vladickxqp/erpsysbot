/**
 * The request's user and company, for pages and server actions.
 */
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_COOKIE, readSession } from "./auth/sessions";
import { contextFor, type Context } from "./context";

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
