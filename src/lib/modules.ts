/**
 * The app's modules. A company switches off what it does not use (for
 * everyone), a person hides what they do not need (only from their own
 * menu). A switched-off module is gone: no menu entry, its pages lead back
 * to the overview, its widgets leave the dashboards.
 */
export const APP_MODULES = [
  "crm",
  "pipeline",
  "calendar",
  "tasks",
  "time",
  "orders",
  "quotes",
  "invoices",
  "finance",
  "products",
  "inventory",
  "documents",
  "media",
  "content",
  "social",
  "reports",
  "team",
  "automation",
  "assistant",
  "integrations",
] as const;

export type AppModule = (typeof APP_MODULES)[number];

export function isAppModule(value: unknown): value is AppModule {
  return typeof value === "string" && (APP_MODULES as readonly string[]).includes(value);
}

/** Where each module lives; the longest matching prefix decides. */
const PATHS: [string, AppModule][] = [
  ["/app/clients", "crm"],
  ["/app/pipeline", "pipeline"],
  ["/app/calendar", "calendar"],
  ["/app/tasks", "tasks"],
  ["/app/time", "time"],
  ["/app/orders", "orders"],
  ["/app/quotes", "quotes"],
  ["/app/invoices", "invoices"],
  ["/app/reminders", "invoices"],
  ["/app/finance", "finance"],
  ["/app/products", "products"],
  ["/app/purchasing", "inventory"],
  ["/app/documents", "documents"],
  ["/app/media", "media"],
  ["/app/content", "content"],
  ["/app/social", "social"],
  ["/app/reports", "reports"],
  ["/app/team", "team"],
  ["/app/automations", "automation"],
  ["/app/assistant", "assistant"],
  ["/app/integrations", "integrations"],
];

export function moduleOfPath(pathname: string): AppModule | null {
  let best: [string, AppModule] | null = null;
  for (const entry of PATHS) {
    const [prefix] = entry;
    if ((pathname === prefix || pathname.startsWith(`${prefix}/`)) && (!best || prefix.length > best[0].length)) best = entry;
  }
  return best ? best[1] : null;
}

/** Only known modules, each once — whatever a form or an old row holds. */
export function cleanModules(values: readonly unknown[] | null | undefined): AppModule[] {
  return APP_MODULES.filter((m) => (values ?? []).includes(m));
}

/** What a module cannot work without. Switching one off switches off what builds on it. */
export const MODULE_REQUIRES: Partial<Record<AppModule, AppModule[]>> = {
  pipeline: ["crm"],
  orders: ["crm"],
  quotes: ["crm"],
  invoices: ["crm"],
  inventory: ["products"],
};

/** The modules switched off, with everything that depends on them. */
export function withDependents(off: readonly unknown[] | null | undefined): AppModule[] {
  const result = new Set(cleanModules(off));
  for (let changed = true; changed; ) {
    changed = false;
    for (const [module, needs] of Object.entries(MODULE_REQUIRES) as [AppModule, AppModule[]][]) {
      if (!result.has(module) && needs.some((n) => result.has(n))) {
        result.add(module);
        changed = true;
      }
    }
  }
  return APP_MODULES.filter((m) => result.has(m));
}

/** Who works here: decides the modules that start switched on and the first dashboard. */
export const WORKSPACE_TYPES = ["BUSINESS", "CREATOR", "FREELANCER", "PERSONAL"] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

export const WORKSPACE_OFF: Record<WorkspaceType, AppModule[]> = {
  BUSINESS: ["content", "social", "time"],
  CREATOR: ["pipeline", "orders", "products", "inventory", "automation"],
  FREELANCER: ["orders", "products", "inventory", "content", "social", "team", "automation"],
  PERSONAL: ["crm", "pipeline", "orders", "quotes", "invoices", "products", "inventory", "content", "social", "reports", "team", "automation", "integrations"],
};
