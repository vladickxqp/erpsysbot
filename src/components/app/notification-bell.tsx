"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/client";

type Line = { id: string; kind: string; vars: Record<string, string | number>; href: string | null; insightKey?: string };

/** The bell in the header: the first lines of the inbox, asked for on every page and when opened. */
export function NotificationBell() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [items, setItems] = useState<Line[]>([]);
  const [count, setCount] = useState(0);
  const load = () => {
    void fetch("/app/notifications")
      .then((r) => (r.ok ? r.json() : { items: [], count: 0 }))
      .then((b: { items?: Line[]; count?: number }) => {
        setItems(b.items ?? []);
        setCount(b.count ?? 0);
      })
      .catch(() => undefined);
  };
  useEffect(load, [pathname]);
  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("hub.inbox.title")}>
          <Bell className="size-4" />
          {count > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">{count}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{t("hub.inbox.title")}</DropdownMenuLabel>
        {items.length === 0 && <div className="px-2 py-3 text-sm text-muted-foreground">{t("widgets.allClear")}</div>}
        {items.map((n) => (
          <DropdownMenuItem key={n.id} asChild>
            <Link href={n.href ?? "/app/inbox"}>{t(n.insightKey ? `hub.i.${n.insightKey}.title` : `hub.n.${n.kind}`, n.vars)}</Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/inbox" className="font-medium">
            {t("hub.inbox.openAll")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
