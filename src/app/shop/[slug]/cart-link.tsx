"use client";

import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-store";

export function CartLink({ storeId, slug, className }: { storeId: string; slug: string; className?: string }) {
  const { t } = useI18n();
  const { count } = useCart(storeId);
  return (
    <Link href={`/shop/${slug}/cart`} className={cn("relative inline-flex size-10 items-center justify-center rounded-md hover:opacity-80", className)} aria-label={t("store.shop.cart")}>
      <ShoppingBag className="size-5" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-[var(--shop-accent)] px-1 text-center text-[11px] font-semibold leading-5 text-white">{count > 99 ? "99+" : count}</span>
      )}
    </Link>
  );
}
