import { CalendarDays, FileSignature, FileText, KanbanSquare, LayoutDashboard, ListTodo, Package, Settings, ShoppingCart, Sparkles, Users, UsersRound, Wallet, type LucideIcon } from "lucide-react";
import type { Permission } from "@/server/permissions";

/** The modules that exist. A module joins this list when it works — no
 *  menu entry leads to a page that does nothing. `primary` entries sit in the
 *  mobile bottom bar, the rest behind "More". A `feature` entry shows only
 *  when that feature is set up on this server. */
export type Feature = "assistant";

export const NAV: { href: string; label: string; icon: LucideIcon; needs?: Permission; primary?: boolean; feature?: Feature }[] = [
  { href: "/app", label: "nav.dashboard", icon: LayoutDashboard, primary: true },
  { href: "/app/assistant", label: "nav.ai", icon: Sparkles, needs: "ai.use", feature: "assistant" },
  { href: "/app/clients", label: "nav.clients", icon: Users, needs: "clients.read", primary: true },
  { href: "/app/pipeline", label: "nav.pipeline", icon: KanbanSquare, needs: "clients.read" },
  { href: "/app/calendar", label: "nav.calendar", icon: CalendarDays, needs: "calendar.read" },
  { href: "/app/tasks", label: "nav.tasks", icon: ListTodo, needs: "tasks.read" },
  { href: "/app/orders", label: "nav.orders", icon: ShoppingCart, needs: "orders.read", primary: true },
  { href: "/app/quotes", label: "nav.quotes", icon: FileSignature, needs: "orders.read" },
  { href: "/app/invoices", label: "nav.invoices", icon: FileText, needs: "invoices.read", primary: true },
  { href: "/app/finance", label: "nav.finance", icon: Wallet, needs: "finance.read" },
  { href: "/app/products", label: "nav2.products", icon: Package, needs: "orders.read" },
  { href: "/app/team", label: "nav.team", icon: UsersRound, needs: "employees.read" },
  { href: "/app/settings", label: "nav.settings", icon: Settings },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}
