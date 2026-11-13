/**
 * The business profile: what a company does, and the setup it confirmed for it.
 *
 * Applying a profile only switches modules on and off (a module switched off
 * keeps all its data and comes back with it), sets the industries, and — only
 * for what the person ticked — adds automations and a dashboard. Nothing is
 * deleted, nothing external is connected or paid for.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { automations, organizations } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isLocale, MESSAGES, translator } from "@/i18n";
import { areasOfIndustries } from "@/lib/areas";
import { AUTOMATION_TEMPLATE_KEYS, AUTOMATION_TEMPLATES, INDUSTRIES, proposal, workspaceTypeOf } from "@/lib/industries";
import { APP_MODULES, withDependents } from "@/lib/modules";
import { audit } from "./audit";
import { saveAutomation } from "./automations";
import type { Context } from "./context";
import { createDashboard, WIDGET_TYPES, newWidget, saveDashboard, type WidgetType } from "./dashboards";
import { requirePermission } from "./permissions";

export const profileInput = z.object({
  industries: z.array(z.enum(INDUSTRIES)).min(1).max(INDUSTRIES.length),
  /** The modules to have on; every other one goes off. */
  modules: z.array(z.enum(APP_MODULES)).min(1),
  automations: z.array(z.enum(AUTOMATION_TEMPLATE_KEYS as [string, ...string[]])).default([]),
  /** A new dashboard for the person applying, made of the proposal's widgets. */
  dashboard: z.boolean().default(false),
});
export type ProfileInput = z.input<typeof profileInput>;

export type AppliedProfile = { modulesOff: string[]; automationsCreated: number; dashboardId: string | null };

export async function applyBusinessProfile(ctx: Context, raw: ProfileInput): Promise<AppliedProfile> {
  requirePermission(ctx.permissions, "settings.manage");
  const input = profileInput.parse(raw);
  const industries = [...new Set(input.industries)];
  const on = new Set(input.modules);
  // A module stays off with what it needs: crm off takes orders, quotes and invoices along.
  const off = withDependents(APP_MODULES.filter((m) => !on.has(m)));
  if (input.automations.length) requirePermission(ctx.permissions, "automation.manage");

  await getDb()
    .update(organizations)
    .set({ industries, areas: areasOfIndustries(industries), workspaceType: workspaceTypeOf(industries), disabledModules: off })
    .where(eq(organizations.id, ctx.organization.id));

  const t = translator(MESSAGES[isLocale(ctx.organization.locale) ? ctx.organization.locale : "de"]);
  let created = 0;
  // Automations need their module; one whose trigger cannot fire here is left out.
  const usable = input.automations.filter((key) => !off.includes(moduleOfTrigger(AUTOMATION_TEMPLATES[key as keyof typeof AUTOMATION_TEMPLATES].trigger)));
  for (const key of usable) {
    const template = AUTOMATION_TEMPLATES[key as keyof typeof AUTOMATION_TEMPLATES];
    const name = t(`industries.automation.${key}.name`);
    // Applied twice, the profile does not make the same rule twice.
    const [known] = await withTenant(ctx.organization.id, (tx) =>
      tx
        .select({ id: automations.id })
        .from(automations)
        .where(and(eq(automations.trigger, template.trigger), eq(automations.action, template.action), eq(automations.name, name)))
        .limit(1),
    );
    if (known) continue;
    const text = t(`industries.automation.${key}.text`);
    await saveAutomation(ctx, null, {
      name,
      trigger: template.trigger,
      action: template.action,
      conditions: template.conditions,
      params: { ...template.params, ...(template.action === "task.create" ? { title: text } : { message: text }) },
      enabled: true,
    });
    created++;
  }

  let dashboardId: string | null = null;
  if (input.dashboard) {
    const widgets = (proposal(industries).widgets as string[]).filter((w): w is WidgetType => (WIDGET_TYPES as readonly string[]).includes(w));
    const board = await createDashboard({ ...ctx, disabledModules: new Set(off) } as Context, t("industries.dashboardName"), "empty");
    // saveDashboard drops what this person may not see.
    dashboardId = (await saveDashboard({ ...ctx, disabledModules: new Set(off) } as Context, board.id, { widgets: widgets.map(newWidget) })).id;
  }

  await withTenant(ctx.organization.id, (tx) =>
    audit(tx, ctx, "company.profile", "organization", ctx.organization.id, { industries, off, automations: created, dashboard: !!dashboardId }),
  );
  return { modulesOff: off, automationsCreated: created, dashboardId };
}

/** The module an automation trigger belongs to. */
function moduleOfTrigger(trigger: string) {
  if (trigger.startsWith("invoice.")) return "invoices";
  if (trigger.startsWith("order.")) return "orders";
  if (trigger.startsWith("stock.")) return "inventory";
  if (trigger.startsWith("project.") || trigger.startsWith("task.")) return "tasks";
  if (trigger.startsWith("deal.")) return "pipeline";
  if (trigger.startsWith("appointment.")) return "calendar";
  return "crm";
}
