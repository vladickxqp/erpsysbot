"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/client";

type Notice = { key: string; vars?: Record<string, string | number>; href: string; tone: string };

/** The bell in the header: asks the server on every page and when opened. */
export function NotificationBell() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [items, setItems] = useState<Notice[]>([]);
  const load = () => {
    void fetch("/app/notifications")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((b: { items?: Notice[] }) => setItems(b.items ?? []))
      .catch(() => undefined);
  };
  useEffect(load, [pathname]);
  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("widgets.notifications")}>
          <Bell className="size-4" />
          {items.length > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">{items.length}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t("widgets.notifications")}</DropdownMenuLabel>
        {items.length === 0 && <div className="px-2 py-3 text-sm text-muted-foreground">{t("widgets.allClear")}</div>}
        {items.map((n) => (
          <DropdownMenuItem key={n.key} asChild>
            <Link href={n.href}>{t(`widgets.n.${n.key}`, n.vars)}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
