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
