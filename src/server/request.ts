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
import { entitlementsOf } from "./billing";
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

/** Which plan module a permission belongs to. */
const MODULE_OF: Record<string, string> = {
  clients: "crm",
  orders: "orders",
  products: "orders",
  invoices: "invoices",
  finance: "finance",
  employees: "team",
  ai: "assistant",
  calendar: "calendar",
  tasks: "tasks",
  documents: "documents",
  inventory: "inventory",
  automation: "automation",
};

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
  const planModule = MODULE_OF[permission.split(".")[0]];
  if (!ent.unlimited && (!ent.active || (planModule && !ent.modules.has(planModule)))) redirect("/app/billing");
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
