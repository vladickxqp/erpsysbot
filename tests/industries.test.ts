import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { AUTOMATION_TEMPLATES, INDUSTRIES, INDUSTRY_PROFILES, proposal, workspaceTypeOf } from "@/lib/industries";
import { APP_MODULES, MODULE_REQUIRES } from "@/lib/modules";
import { listAutomations } from "@/server/automations";
import { applyBusinessProfile } from "@/server/business-profile";
import { contextFor, type Context } from "@/server/context";
import { createDashboard, defaultWidgets, listDashboards, WIDGET_TYPES } from "@/server/dashboards";
import { ForbiddenError } from "@/server/permissions";
import { listProducts, saveProduct } from "@/server/products";
import { newCompany, newMember } from "./helpers";

const fresh = async (ctx: Context) => (await contextFor(ctx.user))!;

describe("industry profiles", () => {
  it("only name modules, widgets and automations that exist", () => {
    for (const industry of INDUSTRIES) {
      const p = INDUSTRY_PROFILES[industry];
      for (const m of p.modules) expect(APP_MODULES).toContain(m);
      for (const w of p.widgets) expect(WIDGET_TYPES).toContain(w);
      for (const a of p.automations) expect(Object.keys(AUTOMATION_TEMPLATES)).toContain(a);
      // A suggested module brings what it needs.
      for (const m of p.modules) for (const need of MODULE_REQUIRES[m] ?? []) expect(p.modules).toContain(need);
    }
  });

  it("join what several industries ask for, and say why", () => {
    const p = proposal(["ONLINE_STORE", "IT_COMPANY"]);
    expect(p.modules).toEqual(expect.arrayContaining(["products", "inventory", "orders", "time", "pipeline", "hr"]));
    expect(p.because.products).toEqual(["ONLINE_STORE"]);
    expect(p.because.crm).toEqual(["ONLINE_STORE", "IT_COMPANY"]);
    expect(p.automations).toEqual(expect.arrayContaining(["overdueReminder", "lowStock", "newOrderTask", "projectDoneInvoice"]));
    expect(new Set(p.widgets).size).toBe(p.widgets.length);
    expect(p.widgets.length).toBeLessThanOrEqual(12);
    expect(p.widgets[1]).toBe("openOrders");
  });

  it("propose nothing for nothing, and ignore what is not an industry", () => {
    expect(proposal([])).toMatchObject({ modules: [], widgets: [], automations: [] });
    expect(proposal(["NOPE" as never]).modules).toEqual([]);
  });

  it("keep the older kind of workspace in step", () => {
    expect(workspaceTypeOf(["CREATOR"])).toBe("CREATOR");
    expect(workspaceTypeOf(["FREELANCER"])).toBe("FREELANCER");
    expect(workspaceTypeOf(["FREELANCER", "CREATOR"])).toBe("BUSINESS");
    expect(workspaceTypeOf(["RETAIL"])).toBe("BUSINESS");
  });
});

describe("applying a business profile", () => {
  it("switches modules as confirmed, with what depends on them", async () => {
    const ctx = await newCompany("Profil GmbH");
    const result = await applyBusinessProfile(ctx, { industries: ["ONLINE_STORE"], modules: ["crm", "invoices", "finance", "tasks", "calendar", "orders"] });
    expect(result.modulesOff).toEqual(expect.arrayContaining(["products", "inventory", "time", "hr"]));
    const [org] = await getDb().select().from(organizations).where(eq(organizations.id, ctx.organization.id));
    expect(org).toMatchObject({ industries: ["ONLINE_STORE"], workspaceType: "BUSINESS" });
    expect(org.disabledModules).not.toContain("orders");

    // Without crm, what builds on it goes off too.
    const again = await applyBusinessProfile(await fresh(ctx), { industries: ["ONLINE_STORE"], modules: ["orders", "tasks"] });
    expect(again.modulesOff).toEqual(expect.arrayContaining(["crm", "orders", "invoices", "quotes", "pipeline"]));
  });

  it("keeps the data of a module switched off and shows it again when it comes back", async () => {
    const ctx = await newCompany("Lager GmbH");
    await applyBusinessProfile(ctx, { industries: ["RETAIL"], modules: proposal(["RETAIL"]).modules });
    const product = await saveProduct(await fresh(ctx), { name: "Ölfilter", unit: "Stk", priceCents: 1999, vatRate: 19 });
    await applyBusinessProfile(await fresh(ctx), { industries: ["CONSULTING"], modules: proposal(["CONSULTING"]).modules });
    const off = await fresh(ctx);
    expect(off.disabledModules.has("products")).toBe(true);
    await applyBusinessProfile(off, { industries: ["CONSULTING", "RETAIL"], modules: proposal(["CONSULTING", "RETAIL"]).modules });
    const back = await fresh(ctx);
    expect(back.disabledModules.has("products")).toBe(false);
    expect((await listProducts(back)).map((p) => p.id)).toContain(product.id);
  });

  it("adds only the ticked automations, once, and none whose module is off", async () => {
    const ctx = await newCompany("Regel GmbH");
    const input = { industries: ["AUTOMOTIVE" as const], modules: proposal(["AUTOMOTIVE"]).modules, automations: ["overdueReminder", "newOrderTask"] };
    expect((await applyBusinessProfile(ctx, input)).automationsCreated).toBe(2);
    expect((await applyBusinessProfile(await fresh(ctx), input)).automationsCreated).toBe(0);
    const { rules } = await listAutomations(await fresh(ctx));
    expect(rules.map((r) => r.trigger).sort()).toEqual(["invoice.overdue", "order.created"]);
    expect(rules.find((r) => r.trigger === "order.created")?.params).toMatchObject({ title: "Auftrag {number} bearbeiten: {client}" });

    const shop = await newCompany("Ohne Lager GmbH");
    const modules = proposal(["ONLINE_STORE"]).modules.filter((m) => m !== "inventory");
    expect((await applyBusinessProfile(shop, { industries: ["ONLINE_STORE"], modules, automations: ["lowStock"] })).automationsCreated).toBe(0);
  });

  it("gives the owner a first dashboard of the industry and adds another only on request", async () => {
    const ctx = await newCompany("Dashboard GmbH");
    await applyBusinessProfile(ctx, { industries: ["IT_COMPANY"], modules: proposal(["IT_COMPANY"]).modules });
    const owner = await fresh(ctx);
    expect(defaultWidgets(owner).map((w) => w.type).slice(0, 3)).toEqual(["quickActions", "projects", "myTasks"]);
    const boards = await listDashboards(owner, "Übersicht");
    expect(boards).toHaveLength(1);
    const result = await applyBusinessProfile(owner, { industries: ["IT_COMPANY", "ONLINE_STORE"], modules: proposal(["IT_COMPANY", "ONLINE_STORE"]).modules, dashboard: true });
    const after = await listDashboards(await fresh(ctx), "Übersicht");
    expect(after).toHaveLength(2);
    expect(after.find((b) => b.id === result.dashboardId)?.widgets.map((w) => w.type)).toContain("openOrders");
    // An employee keeps the view of their own work.
    const employee = await newMember(await fresh(ctx), "EMPLOYEE");
    expect(defaultWidgets(employee).map((w) => w.type)).not.toContain("revenue");
    expect(await createDashboard(employee, "Meins", "default")).toBeDefined();
  });

  it("is only for those who manage the company, and checks what it gets", async () => {
    const ctx = await newCompany("Rechte GmbH");
    const manager = await newMember(ctx, "MANAGER");
    await expect(applyBusinessProfile(manager, { industries: ["RETAIL"], modules: ["crm"] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(applyBusinessProfile(ctx, { industries: [], modules: ["crm"] })).rejects.toThrow();
    await expect(applyBusinessProfile(ctx, { industries: ["MOON" as never], modules: ["crm"] })).rejects.toThrow();
    await expect(applyBusinessProfile(ctx, { industries: ["RETAIL"], modules: [] })).rejects.toThrow();
    await expect(applyBusinessProfile(ctx, { industries: ["RETAIL"], modules: ["crm"], automations: ["rm -rf"] })).rejects.toThrow();
  });

  it("changes nothing in another company", async () => {
    const [a, b] = [await newCompany("Eins GmbH"), await newCompany("Zwei GmbH")];
    await applyBusinessProfile(a, { industries: ["LOGISTICS"], modules: ["crm", "orders"], automations: ["overdueReminder"] });
    const [other] = await getDb().select().from(organizations).where(eq(organizations.id, b.organization.id));
    expect(other.industries).toEqual([]);
    expect((await listAutomations(b)).rules).toEqual([]);
  });
});
