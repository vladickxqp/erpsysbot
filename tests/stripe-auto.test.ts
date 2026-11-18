import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { stores } from "@/db/schema";
import { createStore, getStore, savePayments, storeSecrets, type WebhookSetup } from "@/server/stores";
import { newCompany } from "./helpers";

afterEach(() => vi.unstubAllEnvs());

const KEY = "sk_test_51NexoraTestKey0000000000";
const OTHER = "sk_test_51NexoraTestKey1111111111";
const yes = async () => true;
const rowOf = async (id: string) => (await getDb().select().from(stores).where(eq(stores.id, id)))[0];

/** Stripe as the store sees it: remembers what was set up and what was taken away. */
function fakeStripe(works = true) {
  const made: { key: string; url: string }[] = [];
  const removed: { key: string; id: string }[] = [];
  const hooks: WebhookSetup = {
    create: async (key, url) => {
      if (!works) return null;
      made.push({ key, url });
      return { id: `we_${made.length}`, secret: `whsec_auto${made.length}000000000000` };
    },
    remove: async (key, id) => {
      removed.push({ key, id });
    },
  };
  return { hooks, made, removed };
}

describe("a store's Stripe webhook", () => {
  it("is set up with the key alone, replaced with a new key and taken away with it", async () => {
    vi.stubEnv("APP_URL", "https://shop.example");
    const ctx = await newCompany("Auto Stripe GmbH");
    const store = await createStore(ctx, { name: "Auto" });
    const stripe = fakeStripe();

    await savePayments(ctx, store.id, { bank: false, stripe: true, secretKey: KEY }, yes, stripe.hooks);
    expect(stripe.made).toEqual([{ key: KEY, url: `https://shop.example/api/shop/stripe/${store.id}` }]);
    expect(await getStore(ctx, store.id)).toMatchObject({ payments: { stripe: true }, stripe: { key: true, webhook: true, auto: true } });
    const row = await rowOf(store.id);
    expect(row.stripeWebhookId).toBe("we_1");
    expect(row.stripeWebhookSecret).not.toContain("whsec_");
    expect(storeSecrets(row).webhookSecret).toBe("whsec_auto1000000000000");

    // Saving without a key leaves it alone.
    await savePayments(ctx, store.id, { bank: false, stripe: true }, yes, stripe.hooks);
    expect(stripe.made).toHaveLength(1);
    expect(stripe.removed).toEqual([]);

    await savePayments(ctx, store.id, { bank: false, stripe: true, secretKey: OTHER }, yes, stripe.hooks);
    expect(stripe.removed).toEqual([{ key: KEY, id: "we_1" }]);
    expect((await rowOf(store.id)).stripeWebhookId).toBe("we_2");

    await savePayments(ctx, store.id, { bank: false, stripe: false, removeStripe: true }, yes, stripe.hooks);
    expect(stripe.removed[1]).toEqual({ key: OTHER, id: "we_2" });
    expect((await getStore(ctx, store.id)).stripe).toEqual({ key: false, webhook: false, auto: false, hint: null, connect: { linked: false, ready: false } });
  });

  it("falls back to the typed secret when the key may not set it up", async () => {
    vi.stubEnv("APP_URL", "https://shop.example");
    const ctx = await newCompany("Hand Stripe GmbH");
    const store = await createStore(ctx, { name: "Hand" });
    const stripe = fakeStripe(false);
    await savePayments(ctx, store.id, { bank: false, stripe: true, secretKey: KEY }, yes, stripe.hooks);
    expect(await getStore(ctx, store.id)).toMatchObject({ payments: { stripe: false }, stripe: { key: true, webhook: false, auto: false } });
    await savePayments(ctx, store.id, { bank: false, stripe: true, webhookSecret: "whsec_typed00000000000000" }, yes, stripe.hooks);
    expect(await getStore(ctx, store.id)).toMatchObject({ payments: { stripe: true }, stripe: { key: true, webhook: true, auto: false } });
    expect(stripe.removed).toEqual([]);
  });
});
