/**
 * The three areas of NEXORA ONE: selling goods (Commerce: store, catalogue,
 * stock, suppliers, direct shipping), making content (Creator: content,
 * channels, sponsors) and running the business (Business: sales, quotes,
 * projects, time, people). Each is a set of modules; the core belongs to all
 * of them: clients, tasks, calendar, documents, invoices, money, the assistant.
 *
 * A company uses one area or several; the data is one, so an order from the
 * store is a client and an invoice in Business too. The menu shows one area
 * at a time, and a plan may include some areas or all.
 *
 * Names and rules only, no database code: pages and the server use the same.
 */
import { APP_MODULES, type AppModule } from "./modules";
import type { Industry } from "./industries";

export const AREAS = ["commerce", "creator", "business"] as const;
export type Area = (typeof AREAS)[number];

export const isArea = (value: unknown): value is Area => typeof value === "string" && (AREAS as readonly string[]).includes(value);

/** Only known areas, each once, in their order. */
export const cleanAreas = (values: readonly unknown[] | null | undefined): Area[] => AREAS.filter((a) => (values ?? []).includes(a));

/** In every area. */
export const CORE_MODULES: AppModule[] = ["crm", "calendar", "tasks", "documents", "media", "invoices", "finance", "reports", "team", "chat", "automation", "assistant", "integrations"];

/** What each area adds to the core; a module may serve several areas. */
export const AREA_MODULES: Record<Area, AppModule[]> = {
  commerce: ["orders", "products", "inventory", "store"],
  creator: ["content", "social", "pipeline", "quotes"],
  business: ["pipeline", "quotes", "orders", "products", "time", "hr"],
};

/** The modules that mark an area as in use, for companies that never chose one. */
const SIGNS: Record<Area, AppModule[]> = {
  commerce: ["store", "inventory"],
  creator: ["content", "social"],
  business: ["quotes", "time", "hr", "pipeline"],
};

const AREA_OF_INDUSTRY: Record<Industry, Area> = {
  ONLINE_STORE: "commerce",
  DROPSHIPPING: "commerce",
  RETAIL: "commerce",
  WHOLESALE: "commerce",
  CREATOR: "creator",
  IT_COMPANY: "business",
  SOFTWARE: "business",
  FREELANCER: "business",
  CONSULTING: "business",
  AGENCY: "business",
  AUTOMOTIVE: "business",
  MANUFACTURING: "business",
  LOGISTICS: "business",
  SERVICE: "business",
  OTHER: "business",
};

export function areasOfIndustries(industries: readonly Industry[]): Area[] {
  return cleanAreas(industries.map((i) => AREA_OF_INDUSTRY[i]));
}

/** Everything the areas bring, the core included. */
export function modulesOfAreas(areas: readonly Area[]): AppModule[] {
  const wanted = new Set<AppModule>([...CORE_MODULES, ...areas.flatMap((a) => AREA_MODULES[a])]);
  return APP_MODULES.filter((m) => wanted.has(m));
}

/**
 * The company's areas: the ones it chose, or else what its industries and
 * switched-on modules say; at least one.
 */
export function areasOf(company: { areas?: readonly unknown[] | null; industries?: readonly unknown[] | null; disabledModules?: readonly unknown[] | null }): Area[] {
  const chosen = cleanAreas(company.areas);
  if (chosen.length) return chosen;
  const fromIndustries = areasOfIndustries((company.industries ?? []).filter((i): i is Industry => typeof i === "string" && i in AREA_OF_INDUSTRY));
  if (fromIndustries.length) return fromIndustries;
  const off = new Set(company.disabledModules ?? []);
  const fromModules = AREAS.filter((a) => SIGNS[a].some((m) => !off.has(m)));
  return fromModules.length ? fromModules : ["business"];
}

/**
 * Switching areas: the modules of areas that come are switched on; those
 * that only the leaving areas used are switched off. Modules of areas that
 * stay keep their own setting.
 */
export function modulesAfter(before: readonly Area[], after: readonly Area[], disabled: readonly AppModule[]): AppModule[] {
  const off = new Set(disabled);
  for (const area of after) if (!before.includes(area)) for (const m of AREA_MODULES[area]) off.delete(m);
  const kept = new Set<AppModule>(modulesOfAreas(after));
  for (const area of before) if (!after.includes(area)) for (const m of AREA_MODULES[area]) if (!kept.has(m)) off.add(m);
  return APP_MODULES.filter((m) => off.has(m));
}

/**
 * Where a menu entry of a module goes while this area is shown: the area's
 * own, the core, hidden (it lives in another of the company's areas, one
 * switch away), or "more" (on, but in none of the company's areas).
 */
export function sectionOf(module: AppModule | undefined, area: Area, areas: readonly Area[]): "area" | "core" | "more" | "hidden" | "none" {
  if (!module) return "none";
  if (AREA_MODULES[area].includes(module)) return "area";
  if (CORE_MODULES.includes(module)) return "core";
  if (areas.some((a) => a !== area && AREA_MODULES[a].includes(module))) return "hidden";
  return "more";
}

export type PlanGroup = "business" | "creator" | "commerce" | "complete" | "mixed" | "all";

/** Which shelf of the price list a plan stands on, by the areas it includes. */
export function planGroup(areas: readonly unknown[]): PlanGroup {
  const included = cleanAreas(areas);
  if (!included.length) return "all";
  if (included.length === AREAS.length) return "complete";
  return included.length === 1 ? included[0] : "mixed";
}

const GROUP_ORDER: PlanGroup[] = ["business", "creator", "commerce", "complete", "mixed", "all"];

/** The plans by shelf, in the price list's order. */
export function groupPlans<T extends { areas: readonly unknown[] }>(plans: readonly T[]): { key: PlanGroup; plans: T[] }[] {
  return GROUP_ORDER.map((key) => ({ key, plans: plans.filter((p) => planGroup(p.areas) === key) })).filter((g) => g.plans.length);
}

/** The first board of an area (widget names as in src/server/dashboards.ts). */
export const AREA_WIDGETS: Record<Area, string[]> = {
  commerce: ["quickActions", "openOrders", "revenue", "profit", "outstanding", "insights", "clients", "cashFlow", "recentInvoices"],
  creator: ["quickActions", "insights", "content", "social", "myTasks", "deadlines", "revenue", "expenses", "agenda"],
  business: ["quickActions", "projects", "myTasks", "teamWorkload", "timeWeek", "deadlines", "outstanding", "revenue", "clients"],
};

/** The cookie that remembers the area a person looks at, per device. */
export const AREA_COOKIE = "nx_area";
