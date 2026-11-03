import Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { plans, subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { askAssistantDetailed, conversation } from "@/server/assistant/run";
import type Anthropic from "@anthropic-ai/sdk";
import { registerAccount } from "@/server/accounts";
import { listAutomations, runScheduledAutomations, saveAutomation } from "@/server/automations";
import { entitlementsOf, handleStripeWebhook } from "@/server/billing";
import { createClient } from "@/server/clients";
import { updateCompany } from "@/server/company";
import { contextFor, type Context } from "@/server/context";
import { createInvoiceDraft, issueInvoice } from "@/server/invoices";
import { createOrder, setOrderStatus } from "@/server/orders";
import { invitePlatform, isSuspended, listCompanies, platformStats, setSuspended } from "@/server/platform";
import { listTasks } from "@/server/tasks";
import { inviteMember } from "@/server/team";
import { xrechnungXml } from "@/server/xrechnung";
import { newCompany } from "./helpers";

const unique = (name: string) => `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.org`;

describe("platform admin", () => {
  afterEach(() => {
    process.env.REGISTRATION = "open";
  });

  it("invites new companies while sign-up is closed, sees and suspends companies", async () => {
    const first = await newCompany("Plattform GmbH");
    const admin = { ...first.user, isPlatformAdmin: true };
    process.env.REGISTRATION = "";
    await expect(registerAccount({ name: "Ohne", email: unique("ohne"), password: "long enough password", company: "Ohne GmbH", country: "DE" })).rejects.toMatchObject({ code: "REGISTRATION_CLOSED" });
    await expect(invitePlatform(first.user, unique("x"))).rejects.toMatchObject({ code: "NOT_ADMIN" });

    const invited = unique("neu");
    const token = await invitePlatform(admin, invited);
    // The invitation is for its address: another one is still refused.
    await expect(registerAccount({ name: "Fremd", email: unique("fremd"), password: "long enough password", company: "Fremd GmbH", country: "DE" }, token)).rejects.toMatchObject({ code: "REGISTRATION_CLOSED" });
    const created = await registerAccount({ name: "Neu", email: invited, password: "long enough password", company: "Eingeladen GmbH", country: "DE" }, token);
    await expect(registerAccount({ name: "Zwei", email: unique("zwei"), password: "long enough password", company: "Zweimal GmbH", country: "DE" }, token)).rejects.toMatchObject({ code: "REGISTRATION_CLOSED" });

    expect((await listCompanies(admin)).some((c) => c.id === created.organizationId)).toBe(true);
    expect((await platformStats(admin)).companies).toBeGreaterThan(1);
    await setSuspended(admin, created.organizationId, true);
    expect(await isSuspended(created.organizationId)).toBe(true);
    await setSuspended(admin, created.organizationId, false);
    expect(await isSuspended(created.organizationId)).toBe(false);
  });
});

describe("billing", () => {
  const saved = { key: process.env.STRIPE_SECRET_KEY, hook: process.env.STRIPE_WEBHOOK_SECRET };
  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = saved.key ?? "";
    process.env.STRIPE_WEBHOOK_SECRET = saved.hook ?? "";
  });

  it("gives everything without Stripe; with Stripe the trial plan sets users and modules", async () => {
    const ctx = await newCompany("Abo GmbH");
    expect((await entitlementsOf(ctx.organization.id)).unlimited).toBe(true);

    process.env.STRIPE_SECRET_KEY = "sk_test_local";
    const trial = await entitlementsOf(ctx.organization.id);
    expect(trial).toMatchObject({ active: true, unlimited: false, maxUsers: 10 });
    expect(trial.modules.has("invoices")).toBe(true);
    expect(trial.modules.has("automation")).toBe(false);

    await getDb().update(plans).set({ maxUsers: 2 }).where(eq(plans.id, "business"));
    await inviteMember(ctx, { email: unique("a"), role: "EMPLOYEE" });
    await expect(inviteMember(ctx, { email: unique("b"), role: "EMPLOYEE" })).rejects.toMatchObject({ code: "USER_LIMIT" });
    await getDb().update(plans).set({ maxUsers: 10 }).where(eq(plans.id, "business"));

    await getDb().update(subscriptions).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(subscriptions.organizationId, ctx.organization.id));
    expect((await entitlementsOf(ctx.organization.id)).active).toBe(false);
  });

  it("applies only correctly signed Stripe webhooks, each event once", async () => {
    const ctx = await newCompany("Webhook GmbH");
    process.env.STRIPE_SECRET_KEY = "sk_test_local";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_test";
    await getDb().update(plans).set({ stripePriceId: "price_pro" }).where(eq(plans.id, "professional"));
    const event = {
      id: `evt_${Date.now()}`,
      object: "event",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          object: "subscription",
          status: "active",
          customer: "cus_1",
          cancel_at_period_end: false,
          trial_end: null,
          metadata: { organizationId: ctx.organization.id },
          items: { data: [{ price: { id: "price_pro" }, current_period_end: Math.floor(Date.now() / 1000) + 86_400 * 30 }] },
        },
      },
    };
    const payload = JSON.stringify(event);
    const stripe = new Stripe("sk_test_local");
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_local_test" });

    await expect(handleStripeWebhook(payload, "t=1,v1=forged")).rejects.toThrow();
    expect(await handleStripeWebhook(payload, header)).toBe("ok");
    expect(await handleStripeWebhook(payload, header)).toBe("duplicate");
    const ent = await entitlementsOf(ctx.organization.id);
    expect(ent).toMatchObject({ active: true });
    expect(ent.plan?.id).toBe("professional");
    expect(ent.modules.has("automation")).toBe(true);
  });
});

async function withCompanyData(ctx: Context): Promise<Context> {
  await updateCompany(ctx, { name: ctx.organization.name, street: "Hauptstraße 1", postalCode: "68159", city: "Mannheim", taxNumber: "38/123/45678", email: "info@example.org", iban: "DE89 3704 0044 0532 0130 00" });
  return (await contextFor(ctx.user))!;
}

describe("automations", () => {
  it("creates a task once per overdue invoice and per completed order, and records runs", async () => {
    const ctx = await withCompanyData(await newCompany("Regel GmbH"));
    await saveAutomation(ctx, null, { name: "Mahnen", trigger: "invoice.overdue", conditions: { minDaysOverdue: 3 }, action: "task.create", params: { title: "Anrufen: {client} {number}", dueInDays: 0 } });
    await saveAutomation(ctx, null, { name: "Nachfassen", trigger: "order.completed", conditions: { minAmountCents: 10_000 }, action: "task.create", params: { title: "Bewertung erbitten {number}" } });
    const client = await createClient(ctx, { companyName: "Säumig AG" });
    await issueInvoice(ctx, (await createInvoiceDraft(ctx, { clientId: client.id, dueDate: "2020-01-31", items: [{ description: "x", quantity: 1, unit: "Stk", unitPriceCents: 10_000, vatRate: 19 }] })).id);

    await runScheduledAutomations();
    await runScheduledAutomations();
    const big = await createOrder(ctx, { clientId: client.id, items: [{ description: "Groß", quantity: 1, unit: "Stk", unitPriceCents: 20_000, vatRate: 19 }] });
    const small = await createOrder(ctx, { clientId: client.id, items: [{ description: "Klein", quantity: 1, unit: "Stk", unitPriceCents: 1_000, vatRate: 19 }] });
    await setOrderStatus(ctx, big.id, "COMPLETED");
    await setOrderStatus(ctx, big.id, "COMPLETED");
    await setOrderStatus(ctx, small.id, "COMPLETED");

    const titles = (await listTasks(ctx)).map((t) => t.title).sort();
    expect(titles).toEqual([`Anrufen: Säumig AG RE-${new Date().getFullYear()}-0001`, "Bewertung erbitten #1"].sort());
    expect((await listAutomations(ctx)).runs.every((r) => r.ok)).toBe(true);
  });
});

describe("xrechnung", () => {
  it("writes the issued invoice as UBL with totals, VAT and buyer reference; refuses drafts", async () => {
    const ctx = await withCompanyData(await newCompany("E-Rechnung GmbH"));
    const client = await createClient(ctx, { companyName: "Amt & Co <Stadt>", email: "amt@example.org", buyerReference: "04011000-12345-67" });
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [{ description: "Wartung", quantity: 2, unit: "Std", unitPriceCents: 6_550, vatRate: 19 }] });
    await expect(xrechnungXml(ctx, draft.id)).rejects.toMatchObject({ code: "DRAFT" });
    const issued = await issueInvoice(ctx, draft.id);
    const { xml } = await xrechnungXml(ctx, issued.id);
    expect(xml).toContain("<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>");
    expect(xml).toContain(`<cbc:ID>${issued.number}</cbc:ID>`);
    expect(xml).toContain("<cbc:BuyerReference>04011000-12345-67</cbc:BuyerReference>");
    expect(xml).toContain("Amt &amp; Co &lt;Stadt&gt;");
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="HUR">2</cbc:InvoicedQuantity>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="EUR">155.89</cbc:TaxInclusiveAmount>');
    expect(xml).toContain("<cbc:ID>DE89370400440532013000</cbc:ID>");
  });
});

describe("assistant usage", () => {
  it("stores tokens and the tools used with each answer", async () => {
    const ctx = await newCompany("Verbrauch GmbH");
    let round = 0;
    const reply = (content: unknown[], stop_reason: string) =>
      ({ id: "m", type: "message", role: "assistant", model: "x", content, stop_reason, usage: { input_tokens: 100, output_tokens: 20 } }) as unknown as Anthropic.Beta.BetaMessage;
    const result = await askAssistantDetailed(ctx, "web", "Wie läuft es?", async () =>
      round++ === 0 ? reply([{ type: "tool_use", id: "t", name: "business_overview", input: {} }], "tool_use") : reply([{ type: "text", text: "Gut." }], "end_turn"),
    );
    expect(result).toEqual({ answer: "Gut.", tools: ["business_overview"] });
    const [, answer] = await conversation(ctx, "web");
    expect(answer.tools).toEqual(["business_overview"]);
  });
});
