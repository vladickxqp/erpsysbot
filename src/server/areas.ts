/**
 * The areas a company works in (src/lib/areas.ts): which it has, which its
 * plan allows, and changing them. Changing areas switches modules on and off
 * like a business profile does: nothing is deleted, a module that goes keeps
 * its data and comes back with it.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AREA_MODULES, AREAS, areasOf, cleanAreas, modulesAfter, type Area } from "@/lib/areas";
import { cleanModules, withDependents } from "@/lib/modules";
import { audit } from "./audit";
import { entitlementsOf } from "./billing";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

export class AreaError extends Error {
  constructor(public readonly code: "EMPTY" | "PLAN") {
    super(code);
  }
}

/** The company's areas: chosen, or worked out from what it does. */
export function companyAreas(ctx: Pick<Context, "organization">): Area[] {
  return areasOf(ctx.organization);
}

/** The areas that have something switched on for this company: those the menu offers. */
export function shownAreas(ctx: Pick<Context, "organization" | "disabledModules">): Area[] {
  const areas = companyAreas(ctx);
  const usable = areas.filter((a) => AREA_MODULES[a].some((m) => !ctx.disabledModules.has(m)));
  return usable.length ? usable : areas;
}

/** The areas the plan includes; all of them while nobody pays here. */
export async function allowedAreas(organizationId: string): Promise<Area[]> {
  const ent = await entitlementsOf(organizationId);
  return ent.unlimited ? [...AREAS] : ent.areas;
}

export async function setCompanyAreas(ctx: Context, raw: readonly string[]): Promise<Area[]> {
  requirePermission(ctx.permissions, "settings.manage");
  const areas = cleanAreas(z.array(z.string().max(20)).max(AREAS.length).parse(raw));
  if (!areas.length) throw new AreaError("EMPTY");
  const allowed = await allowedAreas(ctx.organization.id);
  if (areas.some((a) => !allowed.includes(a))) throw new AreaError("PLAN");
  const before = companyAreas(ctx);
  const disabled = withDependents(modulesAfter(before, areas, cleanModules(ctx.organization.disabledModules)));
  await getDb().update(organizations).set({ areas, disabledModules: disabled }).where(eq(organizations.id, ctx.organization.id));
  await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, "company.areas", "organization", ctx.organization.id, { areas, off: disabled }));
  return areas;
}

/** The area shown: the one the person picked last, while the company has it; else its first. */
export function currentArea(areas: readonly Area[], picked: string | null | undefined): Area | null {
  return areas.find((a) => a === picked) ?? areas[0] ?? null;
}
