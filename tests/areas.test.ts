import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NAV, navSections } from "@/components/app/nav";
import { getDb } from "@/db/client";
import { subscriptions, users } from "@/db/schema";
import { areasOf, groupPlans, modulesAfter, modulesOfAreas, planGroup, sectionOf } from "@/lib/areas";
import { allowedAreas, currentArea, setCompanyAreas, shownAreas } from "@/server/areas";
import { applyBusinessProfile } from "@/server/business-profile";
import { contextFor, type Context } from "@/server/context";
import { areaDashboard, listDashboards } from "@/server/dashboards";
import { ForbiddenError } from "@/server/permissions";
import { newCompany, newMember } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The person's context as the next request builds it. */
async function fresh(ctx: Context): Promise<Context> {
  const [user] = await getDb().select().from(users).where(eq(users.id, ctx.user.userId));
  return (await contextFor({ sessionId: "test", userId: user.id, email: user.email, name: user.name, locale: user.locale, isPlatformAdmin: false, activeOrganizationId: ctx.organization.id }))!;
}

describe("area rules", () => {
  it("knows each area's modules, works out a company's areas, and moves modules when areas change", () => {
    expect(modulesOfAreas(["creator"])).toEqual(expect.arrayContaining(["content", "social", "crm", "invoices", "assistant"]));
    expect(modulesOfAreas(["creator"])).not.toContain("store");
    expect(areasOf({ areas: ["creator", "nonsense"] })).toEqual(["creator"]);
    expect(areasOf({ areas: [], industries: ["DROPSHIPPING", "CREATOR", "AGENCY"] })).toEqual(["commerce", "creator", "business"]);
    expect(areasOf({ disabledModules: ["store", "inventory", "quotes", "time", "hr", "pipeline"] })).toEqual(["creator"]);
    expect(areasOf({ disabledModules: ["store", "inventory", "content", "social", "quotes", "time", "hr", "pipeline"] })).toEqual(["business"]);

    // Commerce gets Creator: content and social come on, nothing else changes.
    expect(modulesAfter(["commerce"], ["commerce", "creator"], ["content", "social", "time"])).toEqual(["time"]);
    // Commerce goes: its own modules go with it, what Creator uses stays.
    const off = modulesAfter(["commerce", "creator"], ["creator"], []);
    expect(off).toEqual(expect.arrayContaining(["orders", "products", "inventory", "store"]));
    expect(off).not.toContain("quotes");

    expect(sectionOf("store", "creator", ["commerce", "creator"])).toBe("hidden");
    expect(sectionOf("store", "creator", ["creator"])).toBe("more");
    expect(sectionOf("crm", "creator", ["creator"])).toBe("core");
    expect(sectionOf("content", "creator", ["creator"])).toBe("area");
    expect(sectionOf(undefined, "creator", ["creator"])).toBe("none");
    expect([currentArea(["commerce", "creator"], "creator"), currentArea(["commerce"], "creator"), currentArea([], "creator")]).toEqual(["creator", "commerce", null]);

    expect([planGroup([]), planGroup(["business"]), planGroup(["commerce", "creator", "business"]), planGroup(["commerce", "creator"])]).toEqual(["all", "business", "complete", "mixed"]);
    expect(groupPlans([{ id: "a", areas: ["creator"] }, { id: "b", areas: [] }, { id: "c", areas: ["business"] }]).map((g) => g.key)).toEqual(["business", "creator", "all"]);
  });

  it("shows an area's own entries, then the core, then the rest; the other areas wait one switch away", () => {
    const sections = navSections(NAV, "creator", ["commerce", "creator"]);
    const by = Object.fromEntries(sections.map((s) => [s.key, s.items.map((i) => i.href)]));
    expect(by.top).toEqual(["/app", "/app/today", "/app/inbox", "/app/assistant"]);
    expect(by.area).toEqual(expect.arrayContaining(["/app/content", "/app/social", "/app/pipeline", "/app/quotes"]));
    expect(by.core).toEqual(expect.arrayContaining(["/app/clients", "/app/invoices", "/app/finance"]));
    expect(by.more).toEqual(expect.arrayContaining(["/app/time", "/app/hr"]));
    expect(by.system).toEqual(expect.arrayContaining(["/app/settings"]));
    expect(sections.flatMap((s) => s.items.map((i) => i.href))).not.toContain("/app/store");
    expect(navSections(NAV, null, [])).toEqual([{ key: "top", items: NAV }]);
  });
});

describe("a company's areas", () => {
  it("switches modules with the areas, and only for those who run the company", async () => {
    const ctx = await newCompany("Bereich GmbH");
    expect(await setCompanyAreas(ctx, ["commerce", "nonsense"])).toEqual(["commerce"]);
    let now = await fresh(ctx);
    expect(now.organization.areas).toEqual(["commerce"]);
    for (const m of ["content", "social", "time", "hr"] as const) expect(now.disabledModules.has(m)).toBe(true);
    expect(now.disabledModules.has("store")).toBe(false);
    expect(shownAreas(now)).toEqual(["commerce"]);

    await setCompanyAreas(now, ["commerce", "creator"]);
    now = await fresh(ctx);
    expect(now.disabledModules.has("content")).toBe(false);
    expect(now.disabledModules.has("time")).toBe(true);
    expect(shownAreas(now)).toEqual(["commerce", "creator"]);

    await expect(setCompanyAreas(now, [])).rejects.toMatchObject({ code: "EMPTY" });
    const employee = await newMember(now, "EMPLOYEE");
    await expect(setCompanyAreas(employee, ["creator"])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("takes its areas from the business profile", async () => {
    const ctx = await newCompany("Profil GmbH");
    await applyBusinessProfile(ctx, { industries: ["DROPSHIPPING", "CREATOR"], modules: ["crm", "store", "products", "orders", "content"] });
    expect((await fresh(ctx)).organization.areas).toEqual(["commerce", "creator"]);
  });

  it("opens an area with a board of its own, made once", async () => {
    const ctx = await newCompany("Board GmbH");
    const board = await areaDashboard(ctx, "creator", "Creator", ["revenue", "nonsense"]);
    expect(board).toMatchObject({ name: "Creator", widgets: [{ type: "revenue" }] });
    expect((await areaDashboard(ctx, "creator", "Anders", [])).id).toBe(board.id);
    expect((await listDashboards(ctx, "Übersicht")).map((b) => b.id)).toContain(board.id);
  });

  it("keeps the areas a plan does not include closed", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_areas");
    const ctx = await newCompany("Tarif GmbH");
    await getDb()
      .insert(subscriptions)
      .values({ organizationId: ctx.organization.id, planId: "creator-start", status: "ACTIVE" })
      .onConflictDoUpdate({ target: subscriptions.organizationId, set: { planId: "creator-start", status: "ACTIVE" } });
    const now = await fresh(ctx);
    expect(now.disabledModules.has("store")).toBe(true);
    expect(now.disabledModules.has("content")).toBe(false);
    expect(now.permissions.has("products.manage")).toBe(false);
    expect(now.permissions.has("content.manage")).toBe(true);
    expect(await allowedAreas(ctx.organization.id)).toEqual(["creator"]);
    await expect(setCompanyAreas(now, ["commerce"])).rejects.toMatchObject({ code: "PLAN" });
  });
});
