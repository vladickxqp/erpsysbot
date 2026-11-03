/**
 * The request's user and company, for pages and server actions.
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { moduleOfPath, type AppModule } from "@/lib/modules";
import { SESSION_COOKIE, readSession } from "./auth/sessions";
import { contextFor, type Context } from "./context";
import type { Permission } from "./permissions";
import { entitlementsOf, PLAN_MODULE_OF } from "./billing";
import { isSuspended } from "./platform";
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
  if (!ctx) redirect((await currentUser()) ? "/no-access" : "/login");
  if (!ctx.user.isPlatformAdmin && (await isSuspended(ctx.organization.id))) redirect("/no-access");
  return ctx;
}

/** The context for route handlers: null when signed out or the company is suspended. */
export async function activeContext(): Promise<Context | null> {
  const ctx = await currentContext();
  if (!ctx) return null;
  if (!ctx.user.isPlatformAdmin && (await isSuspended(ctx.organization.id))) return null;
  return ctx;
}

/** A page of a module the company switched off leads back to the overview. */
export function requireModule(ctx: Context, module: AppModule | null): void {
  if (module && ctx.disabledModules.has(module)) redirect("/app");
}

/** The module of the page being rendered (the middleware passes the path along). */
export async function currentModule(): Promise<AppModule | null> {
  return moduleOfPath((await headers()).get("x-pathname") ?? "");
}

/**
 * For pages of a module: without its permission, or with the module switched
 * off, back to the overview; when the plan does not include the module (or
 * the subscription ended), to billing.
 */
export async function requirePageContext(permission: Permission): Promise<Context> {
  const ctx = await requireContext();
  if (!ctx.permissions.has(permission)) redirect("/app");
  requireModule(ctx, await currentModule());
  const ent = await entitlementsOf(ctx.organization.id);
  const planModule = PLAN_MODULE_OF[permission.split(".")[0]];
  if (!ent.unlimited && (!ent.active || (planModule && !ent.modules.has(planModule)))) redirect("/app/billing");
  return ctx;
}

/** https://host of this app, for links in e-mails and messages. */
export async function publicBase(): Promise<string> {
  const configured = appUrl();
  if (configured) return configured;
  const h = await headers();
  // Links in e-mails must not follow a header someone sent: in production only APP_URL or Host count.
  if (process.env.NODE_ENV === "production") console.warn("APP_URL is not set: links in e-mails use the Host header");
  const host = (process.env.NODE_ENV === "production" ? null : h.get("x-forwarded-host")) ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
