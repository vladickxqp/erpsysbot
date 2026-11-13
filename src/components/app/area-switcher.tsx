"use client";

import { Briefcase, ChevronsUpDown, Clapperboard, ShoppingBag, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/client";
import { AREA_COOKIE, type Area } from "@/lib/areas";
import { cn } from "@/lib/utils";

export const AREA_ICON: Record<Area, LucideIcon> = { commerce: ShoppingBag, creator: Clapperboard, business: Briefcase };

/** Remembers the area on this device and opens its overview. */
function usePick() {
  const router = useRouter();
  return (area: Area) => {
    document.cookie = `${AREA_COOKIE}=${area}; path=/; max-age=31536000; samesite=lax`;
    router.push("/app");
    router.refresh();
  };
}

/** The areas side by side at the top of the menu. */
export function AreaSwitcher({ areas, area }: { areas: Area[]; area: Area | null }) {
  const { t } = useI18n();
  const pick = usePick();
  return (
    <div role="tablist" aria-label={t("areas.title")} className="grid gap-1 rounded-xl bg-white/5 p-1" style={{ gridTemplateColumns: `repeat(${areas.length}, minmax(0, 1fr))` }}>
      {areas.map((a) => {
        const Icon = AREA_ICON[a];
        const on = a === area;
        return (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => !on && pick(a)}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-white",
              on && "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span className="max-w-full truncate">{t(`areas.${a}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The same choice on a phone, in the header. */
export function AreaMenu({ areas, area }: { areas: Area[]; area: Area | null }) {
  const { t } = useI18n();
  const pick = usePick();
  if (!area) return null;
  const Icon = AREA_ICON[area];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-sm font-medium" aria-label={t("areas.title")}>
        <Icon className="size-4 text-primary" aria-hidden /> {t(`areas.${area}`)}
        <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {areas.map((a) => {
          const ItemIcon = AREA_ICON[a];
          return (
            <DropdownMenuItem key={a} onClick={() => a !== area && pick(a)} className={cn(a === area && "font-medium text-primary")}>
              <ItemIcon className="size-4" /> {t(`areas.${a}`)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
