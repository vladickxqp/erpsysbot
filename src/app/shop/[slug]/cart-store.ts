"use client";

import { useCallback, useEffect, useState } from "react";
import { MAX_CART_LINES, MAX_QUANTITY, type CartItem } from "@/lib/store";

/**
 * The cart lives in the visitor's browser, per store: only which product,
 * which variant, how many. Prices and stock always come from the server.
 */
const keyOf = (storeId: string) => `nexora-cart-${storeId}`;
const CHANGED = "nexora-cart";

function read(storeId: string): CartItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(keyOf(storeId)) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((i): i is CartItem => !!i && typeof i.productId === "string" && Number.isInteger(i.quantity) && i.quantity > 0)
      .map((i) => ({ productId: i.productId, variantId: typeof i.variantId === "string" ? i.variantId : null, quantity: Math.min(MAX_QUANTITY, i.quantity) }))
      .slice(0, MAX_CART_LINES);
  } catch {
    return [];
  }
}

function write(storeId: string, items: CartItem[]) {
  try {
    localStorage.setItem(keyOf(storeId), JSON.stringify(items.slice(0, MAX_CART_LINES)));
  } catch {
    // Private mode or full storage: the cart lasts as long as the page.
  }
  window.dispatchEvent(new Event(CHANGED));
}

const same = (a: Pick<CartItem, "productId" | "variantId">, b: Pick<CartItem, "productId" | "variantId">) => a.productId === b.productId && (a.variantId ?? null) === (b.variantId ?? null);

export function useCart(storeId: string) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const load = () => setItems(read(storeId));
    load();
    setReady(true);
    window.addEventListener(CHANGED, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(CHANGED, load);
      window.removeEventListener("storage", load);
    };
  }, [storeId]);

  const add = useCallback(
    (item: CartItem) => {
      const current = read(storeId);
      const hit = current.find((i) => same(i, item));
      if (hit) hit.quantity = Math.min(MAX_QUANTITY, hit.quantity + item.quantity);
      else current.push({ ...item, variantId: item.variantId ?? null });
      write(storeId, current);
    },
    [storeId],
  );

  const setQuantity = useCallback(
    (item: Pick<CartItem, "productId" | "variantId">, quantity: number) => {
      const current = read(storeId);
      write(
        storeId,
        quantity > 0 ? current.map((i) => (same(i, item) ? { ...i, quantity: Math.min(MAX_QUANTITY, Math.floor(quantity)) } : i)) : current.filter((i) => !same(i, item)),
      );
    },
    [storeId],
  );

  const clear = useCallback(() => write(storeId, []), [storeId]);

  return { items, ready, count: items.reduce((s, i) => s + i.quantity, 0), add, setQuantity, clear };
}
