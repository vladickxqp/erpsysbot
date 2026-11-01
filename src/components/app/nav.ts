import { FileText, LayoutDashboard, Package, Settings, ShoppingCart, Users, Wallet, type LucideIcon } from "lucide-react";
import type { Permission } from "@/server/permissions";

/** The modules that exist. A module joins this list when it works — no
 *  menu entry leads to a page that does nothing. `primary` entries sit in the
 *  mobile bottom bar, the rest behind "More". */
export const NAV: { href: string; label: string; icon: LucideIcon; needs?: Permission; primary?: boolean }[] = [
  { href: "/app", label: "nav.dashboard", icon: LayoutDashboard, primary: true },
  { href: "/app/clients", label: "nav.clients", icon: Users, needs: "clients.read", primary: true },
  { href: "/app/orders", label: "nav.orders", icon: ShoppingCart, needs: "orders.read", primary: true },
  { href: "/app/invoices", label: "nav.invoices", icon: FileText, needs: "invoices.read", primary: true },
  { href: "/app/finance", label: "nav.finance", icon: Wallet, needs: "finance.read" },
  { href: "/app/products", label: "nav2.products", icon: Package, needs: "orders.read" },
  { href: "/app/settings", label: "nav.settings", icon: Settings },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}
