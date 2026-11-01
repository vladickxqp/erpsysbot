import { LayoutDashboard, Settings, Users, type LucideIcon } from "lucide-react";
import type { Permission } from "@/server/permissions";

/** The modules that exist. A module joins this list when it works — no
 *  menu entry leads to a page that does nothing. */
export const NAV: { href: string; label: string; icon: LucideIcon; needs?: Permission }[] = [
  { href: "/app", label: "nav.dashboard", icon: LayoutDashboard },
  { href: "/app/clients", label: "nav.clients", icon: Users, needs: "clients.read" },
  { href: "/app/settings", label: "nav.settings", icon: Settings },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}
