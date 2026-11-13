"use client";

import { Building2, Check, ChevronsUpDown, LogOut, MoreHorizontal, Plus, Search, Star } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { logoutAction } from "@/app/(auth)/actions";
import { switchCompany } from "@/app/app/actions";
import { createWorkspaceAction } from "@/app/app/workspace-actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { CommandPalette, openPalette } from "./command-palette";
import { LocaleSwitch } from "./locale-switch";
import { Logo } from "./logo";
import type { Area } from "@/lib/areas";
import { AreaMenu, AreaSwitcher } from "./area-switcher";
import { NAV, isActive, navSections, type Feature, type NavItem } from "./nav";
import { NotificationBell } from "./notification-bell";
import { openQuickTask, QuickTaskDialog } from "./quick-task";
import { ThemeToggle } from "./theme-toggle";

export type ShellProps = {
  user: { name: string; email: string };
  company: { id: string; name: string; workspaceType: string | null };
  companies: { id: string; name: string; role: string }[];
  /** The permissions of the current membership, for showing menu entries. */
  permissions: string[];
  /** Optional features set up on this server. */
  features: Feature[];
  /** Modules switched off for the company or hidden by this person. */
  offModules: string[];
  favorites: string[];
  /** The company's areas the menu offers, and the one shown (src/lib/areas.ts). */
  areas: Area[];
  area: Area | null;
  children: React.ReactNode;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function CompanySwitcher({ company, companies }: Pick<ShellProps, "company" | "companies">) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Building2 className="size-4 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-white">{company.name}</span>
            <span className="block truncate text-xs opacity-70">{t(`hub.workspace.${company.workspaceType ?? "BUSINESS"}`)}</span>
          </span>
          <ChevronsUpDown className="size-4 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>{t("nav.company")}</DropdownMenuLabel>
        {companies.map((c) => (
          <DropdownMenuItem key={c.id} onClick={() => c.id !== company.id && start(() => switchCompany(c.id))}>
            <span className="flex-1 truncate">{c.name}</span>
            {c.id === company.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setCreating(true)}>
          <Plus className="size-4" /> {t("workspace.new")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={creating} onOpenChange={setCreating}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("workspace.new")}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createWorkspaceAction(name);
              if (res?.error) toast.error(t(res.error));
            });
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus aria-label={t("workspace.name")} placeholder={t("workspace.name")} />
          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim()}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}

/** Opens the command palette; on a phone a plain icon. */
function GlobalSearch() {
  const { t } = useI18n();
  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        className="hidden h-9 w-full max-w-sm items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground md:flex"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">{t("hub.palette.placeholder")}</span>
        <kbd className="rounded border px-1.5 py-0.5 text-[10px]">Ctrl K</kbd>
      </button>
      <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("common.search")} onClick={openPalette}>
        <Search className="size-4" />
      </Button>
    </>
  );
}

function UserMenu({ user }: Pick<ShellProps, "user">) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={user.name}>
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="font-medium">{user.name}</div>
          <div className="text-xs text-muted-foreground truncate">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/settings">{t("nav.settings")}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => logoutAction()}>
          <LogOut className="size-4" /> {t("auth.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Shell({ user, company, companies, permissions, features, offModules, favorites, areas, area, children }: ShellProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const items = NAV.filter(
    (item) =>
      (!item.needs || permissions.includes(item.needs)) &&
      (!item.feature || features.includes(item.feature)) &&
      (!item.module || !offModules.includes(item.module)),
  );
  const sections = navSections(items, area, areas);
  const ordered = sections.flatMap((s) => s.items);
  return (
    <div className="min-h-dvh bg-background">
      {/* Desktop: fixed sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-sidebar lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/app">
            <Logo inverted />
          </Link>
        </div>
        <div className="px-3">
          <CompanySwitcher company={company} companies={companies} />
        </div>
        {areas.length > 1 && (
          <div className="px-3 pt-3">
            <AreaSwitcher areas={areas} area={area} />
          </div>
        )}
        <nav className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4" aria-label="Main">
          {favorites.length > 0 && (
            <div className="mb-2 space-y-1 border-b border-sidebar-border pb-2">
              {favorites
                .map((href) => items.find((i) => i.href === href))
                .filter((i): i is NavItem => !!i)
                .map(({ href, label }) => (
                  <Link key={href} href={href} className={cn("flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-white", isActive(pathname, href) && "bg-sidebar-accent text-white")}>
                    <Star className="size-3.5 text-warning" fill="currentColor" aria-hidden />
                    {t(label)}
                  </Link>
                ))}
            </div>
          )}
          {sections.map((section) => (
            <div key={section.key} className={cn("space-y-1", section.key !== "top" && "pt-3")}>
              {area && (section.key === "area" || section.key === "core" || section.key === "more") && (
                <div className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-foreground/50 uppercase">{t(section.key === "area" ? `areas.${area}` : `areas.${section.key}`)}</div>
              )}
              {section.items.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={isActive(pathname, href) ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-white",
                    isActive(pathname, href) && "bg-sidebar-accent text-white",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {t(label)}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          <Link href="/app" className="lg:hidden">
            <Logo />
          </Link>
          {areas.length > 1 && (
            <div className="lg:hidden">
              <AreaMenu areas={areas} area={area} />
            </div>
          )}
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            {permissions.includes("tasks.manage") && !offModules.includes("tasks") && (
              <Button variant="ghost" size="icon" aria-label={t("hub.tasks.quick")} onClick={() => openQuickTask()}>
                <Plus className="size-4" />
              </Button>
            )}
            <NotificationBell />
            <LocaleSwitch />
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-24 sm:px-6 lg:pb-10">{children}</main>
      </div>

      {/* Mobile: bottom navigation */}
      <MobileNav items={ordered} pathname={pathname} />
      <QuickTaskDialog />
      <CommandPalette items={items} permissions={permissions} offModules={offModules} favorites={favorites} assistant={features.includes("assistant") && permissions.includes("ai.use") && !offModules.includes("assistant")} />
    </div>
  );
}

function MobileNav({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const { t } = useI18n();
  const primary = items.filter((item) => item.primary);
  const rest = items.filter((item) => !item.primary);
  const tab = "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground";
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 grid border-t bg-background/95 backdrop-blur lg:hidden"
      style={{ gridTemplateColumns: `repeat(${primary.length + (rest.length ? 1 : 0)}, minmax(0, 1fr))`, paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main"
    >
      {primary.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(pathname, href) ? "page" : undefined}
          className={cn(tab, isActive(pathname, href) && "text-primary")}
        >
          <Icon className="size-5" aria-hidden />
          {t(label)}
        </Link>
      ))}
      {rest.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(tab, rest.some((item) => isActive(pathname, item.href)) && "text-primary")}>
            <MoreHorizontal className="size-5" aria-hidden />
            {t("nav.more")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-52">
            {rest.map(({ href, label, icon: Icon }) => (
              <DropdownMenuItem key={href} asChild>
                <Link href={href}>
                  <Icon className="size-4" /> {t(label)}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}
