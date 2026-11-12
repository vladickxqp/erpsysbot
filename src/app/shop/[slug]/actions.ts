"use server";

import { headers } from "next/headers";
import { ZodError } from "zod";
import { currentContext } from "@/server/request";
import { checkout } from "@/server/shop-payments";
import { findStore, priceCart, StorefrontError, type CartInput, type CheckoutInput, type PricedLine } from "@/server/storefront";

export type CartView = {
  lines: PricedLine[];
  goodsCents: number;
  shippingId: string | null;
  shippingCents: number | null;
  vatCents: number;
  grossCents: number;
  byRate: { rate: number; vatCents: number }[];
  ok: boolean;
};

/** The cart priced by the server; null when the store is not open to this visitor. */
export async function priceCartAction(slug: string, items: CartInput, shippingId: string | null): Promise<CartView | null> {
  const store = await findStore(slug, await currentContext());
  if (!store) return null;
  try {
    const cart = await priceCart(store, items, shippingId);
    return {
      lines: cart.lines,
      goodsCents: cart.goodsCents,
      shippingId: cart.shipping?.option.id ?? null,
      shippingCents: cart.shipping?.cents ?? null,
      vatCents: cart.vatCents,
      grossCents: cart.grossCents,
      byRate: cart.byRate,
      ok: cart.ok,
    };
  } catch (e) {
    if (e instanceof ZodError) return null;
    throw e;
  }
}

export type CheckoutResult = { ok: true; token: string; payUrl: string | null } | { ok: false; error: string; lines?: { name: string; available: number }[] };

/** Who is ordering, as far as a limit per visitor needs it: Cloudflare's address of the visitor. */
async function visitor(): Promise<string> {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";
}

export async function checkoutAction(slug: string, input: CheckoutInput): Promise<CheckoutResult> {
  const store = await findStore(slug, await currentContext());
  if (!store) return { ok: false, error: "store.shop.error.CLOSED" };
  try {
    const done = await checkout(store, input, await visitor());
    return { ok: true, ...done };
  } catch (e) {
    if (e instanceof StorefrontError) return { ok: false, error: `store.shop.error.${e.code}`, lines: e.lines };
    if (e instanceof ZodError) return { ok: false, error: "store.shop.error.FORM" };
    throw e;
  }
}
