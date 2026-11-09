/**
 * What a business does, and what NEXORA ONE suggests for it: modules, a first
 * dashboard and ready-made automations. A company may do several things at
 * once; the suggestions are joined. Nothing here is applied by itself — the
 * person reviews the proposal and confirms it (src/server/business-profile.ts).
 * No database code: forms use it too.
 */
import { APP_MODULES, type AppModule, type WorkspaceType } from "./modules";

export const INDUSTRIES = [
  "ONLINE_STORE",
  "DROPSHIPPING",
  "RETAIL",
  "WHOLESALE",
  "IT_COMPANY",
  "SOFTWARE",
  "FREELANCER",
  "CONSULTING",
  "AGENCY",
  "AUTOMOTIVE",
  "MANUFACTURING",
  "LOGISTICS",
  "CREATOR",
  "SERVICE",
  "OTHER",
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const isIndustry = (value: unknown): value is Industry => typeof value === "string" && (INDUSTRIES as readonly string[]).includes(value);

/** Only known industries, each once, in catalogue order. */
export const cleanIndustries = (values: readonly unknown[] | null | undefined): Industry[] => INDUSTRIES.filter((i) => (values ?? []).includes(i));

/** Widget names as in src/server/dashboards.ts; kept as strings so this file stays free of server code. */
type WidgetName =
  | "quickActions" | "revenue" | "expenses" | "profit" | "outstanding" | "openOrders" | "clients" | "cashFlow" | "clientGrowth"
  | "myTasks" | "projects" | "agenda" | "content" | "social" | "recentInvoices" | "insights" | "inbox" | "approvals"
  | "deadlines" | "teamWorkload" | "timeWeek";

/** Ready-made automations, built only from triggers and actions the engine has (src/server/automations.ts). */
export const AUTOMATION_TEMPLATES = {
  overdueReminder: { trigger: "invoice.overdue", action: "inbox.notify", conditions: { minDaysOverdue: 3 }, params: { to: "owner" } },
  lowStock: { trigger: "stock.low", action: "inbox.notify", conditions: {}, params: { to: "admins" } },
  newOrderTask: { trigger: "order.created", action: "task.create", conditions: {}, params: { dueInDays: 1, priority: "MEDIUM" } },
  orderDoneInvoice: { trigger: "order.completed", action: "task.create", conditions: {}, params: { dueInDays: 0, priority: "HIGH" } },
  projectDoneInvoice: { trigger: "project.completed", action: "task.create", conditions: {}, params: { dueInDays: 2, priority: "HIGH" } },
  newClientCall: { trigger: "client.created", action: "task.create", conditions: {}, params: { dueInDays: 1, priority: "MEDIUM" } },
} as const;
export type AutomationTemplate = keyof typeof AUTOMATION_TEMPLATES;
export const AUTOMATION_TEMPLATE_KEYS = Object.keys(AUTOMATION_TEMPLATES) as AutomationTemplate[];

type Profile = { modules: AppModule[]; widgets: WidgetName[]; automations: AutomationTemplate[] };

const BASE: AppModule[] = ["crm", "calendar", "tasks", "quotes", "invoices", "finance", "documents", "reports", "team", "assistant", "integrations", "automation"];
const STORE_WIDGETS: WidgetName[] = ["quickActions", "openOrders", "revenue", "profit", "outstanding", "insights", "clients", "cashFlow", "recentInvoices"];
const PROJECT_WIDGETS: WidgetName[] = ["quickActions", "projects", "myTasks", "teamWorkload", "timeWeek", "deadlines", "outstanding", "revenue", "clients"];
const WORKSHOP_WIDGETS: WidgetName[] = ["quickActions", "agenda", "openOrders", "myTasks", "timeWeek", "outstanding", "revenue", "clients", "insights"];
const PRODUCTION_WIDGETS: WidgetName[] = ["quickActions", "openOrders", "projects", "deadlines", "teamWorkload", "revenue", "expenses", "profit", "insights"];

export const INDUSTRY_PROFILES: Record<Industry, Profile> = {
  ONLINE_STORE: { modules: [...BASE, "products", "inventory", "orders", "media"], widgets: STORE_WIDGETS, automations: ["overdueReminder", "lowStock", "newOrderTask"] },
  DROPSHIPPING: { modules: [...BASE, "products", "inventory", "orders"], widgets: STORE_WIDGETS, automations: ["overdueReminder", "newOrderTask"] },
  RETAIL: { modules: [...BASE, "products", "inventory", "orders", "time", "hr"], widgets: STORE_WIDGETS, automations: ["overdueReminder", "lowStock", "newOrderTask"] },
  WHOLESALE: { modules: [...BASE, "products", "inventory", "orders", "pipeline"], widgets: STORE_WIDGETS, automations: ["overdueReminder", "lowStock", "newOrderTask", "newClientCall"] },
  IT_COMPANY: { modules: [...BASE, "pipeline", "time", "hr", "chat"], widgets: PROJECT_WIDGETS, automations: ["overdueReminder", "projectDoneInvoice"] },
  SOFTWARE: { modules: [...BASE, "pipeline", "time", "hr", "chat"], widgets: PROJECT_WIDGETS, automations: ["overdueReminder", "projectDoneInvoice"] },
  FREELANCER: {
    modules: ["crm", "calendar", "tasks", "time", "quotes", "invoices", "finance", "documents", "reports", "assistant", "integrations"],
    widgets: ["quickActions", "insights", "myTasks", "projects", "timeWeek", "outstanding", "revenue", "expenses", "agenda"],
    automations: ["overdueReminder", "projectDoneInvoice"],
  },
  CONSULTING: { modules: [...BASE, "pipeline", "time", "hr", "chat"], widgets: PROJECT_WIDGETS, automations: ["overdueReminder", "projectDoneInvoice", "newClientCall"] },
  AGENCY: { modules: [...BASE, "pipeline", "time", "hr", "chat", "media", "content"], widgets: PROJECT_WIDGETS, automations: ["overdueReminder", "projectDoneInvoice", "newClientCall"] },
  AUTOMOTIVE: { modules: [...BASE, "orders", "products", "inventory", "time", "hr"], widgets: WORKSHOP_WIDGETS, automations: ["overdueReminder", "lowStock", "newOrderTask", "orderDoneInvoice"] },
  MANUFACTURING: { modules: [...BASE, "products", "inventory", "orders", "time", "hr"], widgets: PRODUCTION_WIDGETS, automations: ["overdueReminder", "lowStock", "newOrderTask"] },
  LOGISTICS: { modules: [...BASE, "orders", "time", "hr", "chat"], widgets: PRODUCTION_WIDGETS, automations: ["overdueReminder", "newOrderTask"] },
  CREATOR: {
    modules: ["crm", "calendar", "tasks", "time", "quotes", "invoices", "finance", "documents", "media", "content", "social", "reports", "team", "chat", "assistant", "integrations"],
    widgets: ["quickActions", "insights", "content", "social", "myTasks", "deadlines", "revenue", "expenses", "agenda"],
    automations: ["overdueReminder"],
  },
  SERVICE: { modules: [...BASE, "orders", "time"], widgets: WORKSHOP_WIDGETS, automations: ["overdueReminder", "newOrderTask", "orderDoneInvoice"] },
  OTHER: {
    modules: [...BASE, "orders", "products", "time"],
    widgets: ["quickActions", "insights", "revenue", "expenses", "profit", "outstanding", "projects", "myTasks", "approvals", "clients", "agenda", "recentInvoices"],
    automations: ["overdueReminder"],
  },
};

const MAX_WIDGETS = 12;

export type Proposal = {
  modules: AppModule[];
  widgets: WidgetName[];
  automations: AutomationTemplate[];
  /** For each module and automation: the industries that ask for it. */
  because: Record<string, Industry[]>;
};

/** The joined suggestion for these industries; empty when none is chosen. */
export function proposal(industries: readonly Industry[]): Proposal {
  const chosen = cleanIndustries(industries);
  const because: Record<string, Industry[]> = {};
  const note = (key: string, industry: Industry) => {
    because[key] = [...(because[key] ?? []), industry];
  };
  const widgets: WidgetName[] = [];
  for (const industry of chosen) {
    const profile = INDUSTRY_PROFILES[industry];
    profile.modules.forEach((m) => note(m, industry));
    profile.automations.forEach((a) => note(a, industry));
    for (const w of profile.widgets) if (!widgets.includes(w)) widgets.push(w);
  }
  return {
    modules: APP_MODULES.filter((m) => because[m]),
    widgets: widgets.slice(0, MAX_WIDGETS),
    automations: AUTOMATION_TEMPLATE_KEYS.filter((a) => because[a]),
    because,
  };
}

/** The older, coarser kind of workspace that other parts still read. */
export function workspaceTypeOf(industries: readonly Industry[]): WorkspaceType {
  const chosen = cleanIndustries(industries);
  if (chosen.length && chosen.every((i) => i === "CREATOR")) return "CREATOR";
  if (chosen.length && chosen.every((i) => i === "FREELANCER")) return "FREELANCER";
  return "BUSINESS";
}
