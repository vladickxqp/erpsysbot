import { BarChart3, CalendarDays, ScrollText, Clapperboard, CreditCard, Images, Plug, Share2, ShieldCheck, Workflow, FolderOpen, Truck, FileSignature, FileText, KanbanSquare, LayoutDashboard, ListTodo, Package, Settings, ShoppingCart, Sparkles, Users, UsersRound, Wallet, type LucideIcon } from "lucide-react";
import type { AppModule } from "@/lib/modules";
import type { Permission } from "@/server/permissions";

/** The modules that exist. A module joins this list when it works — no
 *  menu entry leads to a page that does nothing. `primary` entries sit in the
 *  mobile bottom bar, the rest behind "More". A `feature` entry shows only
 *  when that feature is set up on this server; a `module` entry only while
 *  the company has it switched on and the person has not hidden it. */
export type Feature = "assistant" | "admin" | "billing";

export type NavItem = { href: string; label: string; icon: LucideIcon; needs?: Permission; primary?: boolean; feature?: Feature; module?: AppModule };

export const NAV: NavItem[] = [
  { href: "/app", label: "nav.dashboard", icon: LayoutDashboard, primary: true },
  { href: "/app/assistant", label: "nav.ai", icon: Sparkles, needs: "ai.use", feature: "assistant", module: "assistant" },
  { href: "/app/clients", label: "nav.clients", icon: Users, needs: "clients.read", primary: true, module: "crm" },
  { href: "/app/pipeline", label: "nav.pipeline", icon: KanbanSquare, needs: "clients.read", module: "pipeline" },
  { href: "/app/calendar", label: "nav.calendar", icon: CalendarDays, needs: "calendar.read", module: "calendar" },
  { href: "/app/tasks", label: "nav.tasks", icon: ListTodo, needs: "tasks.read", module: "tasks" },
  { href: "/app/orders", label: "nav.orders", icon: ShoppingCart, needs: "orders.read", primary: true, module: "orders" },
  { href: "/app/quotes", label: "nav.quotes", icon: FileSignature, needs: "orders.read", module: "quotes" },
  { href: "/app/invoices", label: "nav.invoices", icon: FileText, needs: "invoices.read", primary: true, module: "invoices" },
  { href: "/app/finance", label: "nav.finance", icon: Wallet, needs: "finance.read", module: "finance" },
  { href: "/app/products", label: "nav2.products", icon: Package, needs: "orders.read", module: "products" },
  { href: "/app/purchasing", label: "inventory.title", icon: Truck, needs: "orders.read", module: "inventory" },
  { href: "/app/content", label: "studio.title", icon: Clapperboard, needs: "content.read", module: "content" },
  { href: "/app/social", label: "social.title", icon: Share2, needs: "content.read", module: "social" },
  { href: "/app/media", label: "media.title", icon: Images, needs: "documents.read", module: "media" },
  { href: "/app/documents", label: "documents.title", icon: FolderOpen, needs: "documents.read", module: "documents" },
  { href: "/app/reports", label: "reports.title", icon: BarChart3, needs: "clients.read", module: "reports" },
  { href: "/app/team", label: "nav.team", icon: UsersRound, needs: "employees.read", module: "team" },
  { href: "/app/automations", label: "automation.title", icon: Workflow, needs: "automation.manage", module: "automation" },
  { href: "/app/integrations", label: "integrations.title", icon: Plug, needs: "settings.manage", module: "integrations" },
  { href: "/app/audit", label: "audit.title", icon: ScrollText, needs: "settings.manage" },
  { href: "/app/settings", label: "nav.settings", icon: Settings },
  { href: "/app/billing", label: "billing.title", icon: CreditCard, needs: "billing.manage", feature: "billing" },
  { href: "/app/admin", label: "admin.title", icon: ShieldCheck, feature: "admin" },
];

/** The menu label of each module, for the module settings. */
export const MODULE_LABEL: Record<AppModule, string> = Object.fromEntries(
  NAV.filter((item) => item.module).map((item) => [item.module, item.label]),
) as Record<AppModule, string>;

export function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}
