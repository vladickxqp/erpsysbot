import Link from "next/link";
import { cn } from "@/lib/utils";
import type { PublicStore, ShopProduct } from "@/server/storefront";
import { shopWords } from "./store";
import { LOOK, ShopImage } from "./ui";

export function ProductGrid({ store, products }: { store: PublicStore; products: ShopProduct[] }) {
  const { t, money } = shopWords(store);
  const look = LOOK[store.design.template];
  if (!products.length) return <p className="py-8 text-center text-sm text-slate-500">{t("store.shop.noProducts")}</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <li key={p.id}>
          <Link href={`/shop/${store.slug}/p/${p.id}`} className={cn("group grid h-full overflow-hidden", look.card, look.radius)}>
            <ShopImage slug={store.slug} id={p.imageId} alt={p.name} className="aspect-square w-full transition-transform group-hover:scale-[1.02]" />
            <div className="grid content-start gap-1 p-3">
              <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
              <span className="text-sm">
                {p.fromPrice && `${t("store.shop.from")} `}
                <span className="font-semibold">{money(p.priceCents)}</span>
              </span>
              {!p.available && <span className="text-xs text-slate-500">{t("store.shop.soldOut")}</span>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** "incl. VAT, plus shipping" — or the small-business note: what a price includes. */
export function PriceNote({ store }: { store: PublicStore }) {
  const { t } = shopWords(store);
  return (
    <p className="text-xs text-slate-500">
      {t(store.smallBusiness ? "store.shop.noVat" : "store.shop.inclVat")} ·{" "}
      <Link href={`/shop/${store.slug}/info/shipping`} className="underline">
        {t("store.shop.plusShipping")}
      </Link>
    </p>
  );
}
