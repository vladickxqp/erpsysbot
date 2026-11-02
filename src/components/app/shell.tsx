"use client";

import { Building2, Check, ChevronsUpDown, LogOut, MoreHorizontal, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logoutAction } from "@/app/(auth)/actions";
import { switchCompany } from "@/app/app/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { LocaleSwitch } from "./locale-switch";
import { Logo } from "./logo";
import { NAV, isActive, type Feature } from "./nav";
import { ThemeToggle } from "./theme-toggle";

export type ShellProps = {
  user: { name: string; email: string };
  company: { id: string; name: string };
  companies: { id: string; name: string; role: string }[];
  /** The permissions of the current membership, for showing menu entries. */
  permissions: string[];
  /** Optional features set up on this server. */
  features: Feature[];
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Building2 className="size-4 shrink-0 opacity-70" />
          <span className="flex-1 truncate font-medium text-white">{company.name}</span>
          {companies.length > 1 && <ChevronsUpDown className="size-4 opacity-60" />}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GlobalSearch() {
  const { t } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      className="relative hidden md:block w-full max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/app/clients?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("clients.searchPlaceholder")}
        aria-label={t("common.search")}
        className="pl-8 bg-background"
      />
    </form>
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

export function Shell({ user, company, companies, permissions, features, children }: ShellProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const items = NAV.filter((item) => (!item.needs || permissions.includes(item.needs)) && (!item.feature || features.includes(item.feature)));
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
        <nav className="mt-4 flex-1 space-y-1 px-3" aria-label="Main">
          {items.map(({ href, label, icon: Icon }) => (
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
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          <Link href="/app" className="lg:hidden">
            <Logo />
          </Link>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitch />
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-24 sm:px-6 lg:pb-10">{children}</main>
      </div>

      {/* Mobile: bottom navigation */}
      <MobileNav items={items} pathname={pathname} />
    </div>
  );
}

function MobileNav({ items, pathname }: { items: typeof NAV; pathname: string }) {
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
