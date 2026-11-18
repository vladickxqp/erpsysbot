import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { getOrder, listOrders } from "@/server/orders";
import { saveProduct } from "@/server/products";
import { refundOrder, type StripeRefund } from "@/server/refunds";
import { checkout, handleConnectWebhook, type CreateSession } from "@/server/shop-payments";
import { createStore, disconnectStripe, getStore, refreshConnect, savePages, savePayments, saveShippingOptions, setStoreStatus, startConnect, type ConnectApi } from "@/server/stores";
import { findStore, type CheckoutInput } from "@/server/storefront";
import { newCompany, newMember } from "./helpers";

afterEach(() => vi.unstubAllEnvs());

const PLATFORM = "sk_test_51PlatformKey0000000000000";
const HOOK = "whsec_connecttest00000000000000";

function platform(fee = "5") {
  vi.stubEnv("APP_URL", "https://shop.example");
  vi.stubEnv("STRIPE_CONNECT_SECRET_KEY", PLATFORM);
  vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", HOOK);
  vi.stubEnv("STRIPE_CONNECT_FEE_PERCENT", fee);
}

/** Stripe's Connect pages as the shop sees them. */
function fakeConnect(ready = true) {
  const created: Record<string, unknown>[] = [];
  const links: string[][] = [];
  const api: ConnectApi = {
    createAccount: async (key, p) => {
      created.push({ key, ...p });
      return "acct_test_1";
    },
    link: async (key, account, refresh, back) => {
      links.push([key, account, refresh, back]);
      return "https://connect.stripe.com/setup/s/acct_test_1/test";
    },
    ready: async () => ready,
  };
  return { api, created, links };
}

async function shopOf(name: string) {
  const ctx = await newCompany(name);
  await getDb()
    .update(organizations)
    .set({ street: "Hauptstr. 1", postalCode: "10115", city: "Berlin", email: "shop@example.org", iban: "DE89370400440532013000" })
    .where(eq(organizations.id, ctx.organization.id));
  const store = await createStore(ctx, { name });
  await saveShippingOptions(ctx, store.id, [{ name: "DHL", priceCents: 490, freeFromCents: null }]);
  await savePages(ctx, store.id, { imprint: "Firma", privacy: "Daten", terms: "AGB", withdrawal: "Widerruf" });
  await savePayments(ctx, store.id, { bank: true, stripe: false }, async () => true);
  const lamp = await saveProduct(ctx, { kind: "PRODUCT", name: "Lampe", priceCents: 1000, vatRate: 19 });
  return { ctx, storeId: store.id, lamp };
}

const buyer = (productId: string, shippingId: string): CheckoutInput => ({
  items: [{ productId, quantity: 2 }],
  email: "eva@example.org",
  shipping: { firstName: "Eva", lastName: "Muster", street: "Weg 1", postalCode: "20095", city: "Hamburg", country: "DE" },
  shippingId,
  payment: "stripe",
  acceptTerms: true,
});

const signed = (event: Record<string, unknown>) => {
  const payload = JSON.stringify({ object: "event", id: `evt_${Math.random().toString(36).slice(2)}`, ...event });
  return { payload, signature: new Stripe(PLATFORM).webhooks.generateTestHeaderString({ payload, secret: HOOK }) };
};

describe("Stripe Connect", () => {
  it("connects a shop with one button, takes cards through its account with the platform's share, and refunds there", async () => {
    const { ctx, storeId, lamp } = await shopOf("Connect GmbH");
    const stripe = fakeConnect();
    await expect(startConnect(ctx, storeId, stripe.api)).rejects.toMatchObject({ code: "CONNECT" });

    platform();
    expect(await startConnect(ctx, storeId, stripe.api)).toBe("https://connect.stripe.com/setup/s/acct_test_1/test");
    expect(stripe.created).toEqual([{ key: PLATFORM, country: "DE", email: "shop@example.org", storeId, organizationId: ctx.organization.id }]);
    const back = `https://shop.example/app/store/${storeId}?tab=payment`;
    expect(stripe.links[0]).toEqual([PLATFORM, "acct_test_1", `${back}&connect=retry`, `${back}&connect=done`]);
    // A second click continues with the same account.
    await startConnect(ctx, storeId, stripe.api);
    expect(stripe.created).toHaveLength(1);
    expect(await getStore(ctx, storeId)).toMatchObject({ payments: { stripe: false }, stripe: { key: false, connect: { linked: true, ready: false } } });

    expect(await refreshConnect(ctx, storeId, fakeConnect(false).api)).toBe(false);
    expect(await refreshConnect(ctx, storeId, stripe.api)).toBe(true);
    expect(await getStore(ctx, storeId)).toMatchObject({ payments: { bank: true, stripe: true }, stripe: { connect: { linked: true, ready: true } } });

    await setStoreStatus(ctx, storeId, "PUBLISHED");
    const shop = (await findStore((await getStore(ctx, storeId)).slug))!;
    expect(shop.methods).toEqual(["bank", "stripe"]);
    const calls: { key: string; params: Stripe.Checkout.SessionCreateParams; account: string | null | undefined }[] = [];
    const create: CreateSession = async (key, params, _idem, account) => {
      calls.push({ key, params, account });
      return { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" };
    };
    await checkout(shop, buyer(lamp.id, shop.shipping[0].id), "1.2.3.4", create);
    const [order] = (await listOrders(ctx)).rows;
    expect(calls[0]).toMatchObject({ key: PLATFORM, account: "acct_test_1" });
    expect(calls[0].params.payment_intent_data?.application_fee_amount).toBe(Math.round(order.grossCents * 0.05));

    // Stripe tells the platform; the order of the connected shop is paid.
    const forged = signed({ type: "checkout.session.completed", account: "acct_test_1", data: { object: {} } });
    await expect(handleConnectWebhook(forged.payload, forged.signature.replace(/v1=[0-9a-f]+/, `v1=${"0".repeat(64)}`))).rejects.toMatchObject({ code: "SIGNATURE" });
    const paid = signed({
      type: "checkout.session.completed",
      account: "acct_test_1",
      data: {
        object: {
          id: "cs_test_1",
          object: "checkout.session",
          payment_status: "paid",
          amount_total: order.grossCents,
          currency: "eur",
          metadata: { orderId: order.id },
          client_reference_id: order.id,
          payment_intent: "pi_test_9",
          customer_details: { email: "eva@example.org" },
        },
      },
    });
    expect(await handleConnectWebhook(paid.payload, paid.signature)).toBe("paid");
    expect((await getOrder(ctx, order.id)).order).toMatchObject({ paymentStatus: "PAID", paymentReference: "pi_test_9" });
    expect(await handleConnectWebhook(paid.payload, paid.signature)).toBe("duplicate");
    const stranger = signed({ type: "checkout.session.completed", account: "acct_other", data: { object: {} } });
    expect(await handleConnectWebhook(stranger.payload, stranger.signature)).toBe("unknown account");

    const refunds: { key: string; account: string | null | undefined }[] = [];
    const refund: StripeRefund = async (key, p) => {
      refunds.push({ key, account: p.account });
      return { id: "re_test_1", status: "succeeded" };
    };
    await refundOrder(ctx, order.id, { amountCents: 500, provider: "stripe" }, refund);
    expect(refunds).toEqual([{ key: PLATFORM, account: "acct_test_1" }]);

    // The account can no longer take payments: no card in the shop until it can again.
    const paused = signed({ type: "account.updated", account: "acct_test_1", data: { object: { id: "acct_test_1", object: "account", charges_enabled: false, details_submitted: true } } });
    expect(await handleConnectWebhook(paused.payload, paused.signature)).toBe("account");
    expect((await findStore(shop.slug))!.methods).toEqual(["bank"]);

    await disconnectStripe(ctx, storeId);
    expect(await getStore(ctx, storeId)).toMatchObject({ payments: { stripe: false }, stripe: { connect: { linked: false, ready: false } } });
  });

  it("is for those who manage the company's settings, and off without the platform's keys", async () => {
    platform("0");
    const { ctx, storeId } = await shopOf("Rechte Connect GmbH");
    const viewer = await newMember(ctx, "VIEWER");
    await expect(startConnect(viewer, storeId, fakeConnect().api)).rejects.toMatchObject({ permission: "settings.manage" });
    const other = await newCompany("Fremd Connect GmbH");
    await expect(startConnect(other, storeId, fakeConnect().api)).rejects.toThrow();
    vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "");
    await expect(startConnect(ctx, storeId, fakeConnect().api)).rejects.toMatchObject({ code: "CONNECT" });
    const hook = signed({ type: "account.updated", account: "acct_test_1", data: { object: {} } });
    await expect(handleConnectWebhook(hook.payload, hook.signature)).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});
