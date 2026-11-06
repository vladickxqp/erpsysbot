import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { subscriptions, suspensions } from "@/db/schema";
import { formatMoney } from "@/i18n";
import { allowedRates, countryProfile, isBlockedCountry, parseRate, validTaxId } from "@/lib/countries";
import { AccountError, authenticate, registerAccount } from "@/server/accounts";
import { handleStripeWebhook } from "@/server/billing";
import { createClient } from "@/server/clients";
import { updateCompany } from "@/server/company";
import { contextFor, type Context } from "@/server/context";
import { createInvoiceDraft, InvoiceStateError, issueInvoice } from "@/server/invoices";
import { setCompanyCountry, suspensionOf } from "@/server/platform";
import { renderInvoice } from "@/server/send";
import { keepInvoiceFile } from "@/server/invoice-files";
import { newCompany } from "./helpers";

let n = 0;
const email = (name: string) => `${name}${(n += 1)}-${Date.now()}@example.org`;
const reload = async (ctx: Context) => (await contextFor(ctx.user))!;
const line = (price: number, vatRate: number) => ({ description: "Work", quantity: 1, unitPriceCents: price * 100, vatRate });

describe("country profiles", () => {
  it("knows currency, tax and paper by country, and closes Russia and Belarus", () => {
    expect(countryProfile("US")).toMatchObject({ currency: "USD", taxKind: "SALES_TAX", paper: "LETTER", iban: false, smallBusiness: null });
    expect(countryProfile("DE")).toMatchObject({ currency: "EUR", taxRates: [19, 7], xrechnung: true, requiresTaxId: true });
    expect(countryProfile("KZ")).toMatchObject({ currency: "KZT", taxRates: [16], requiresTaxId: true });
    expect(countryProfile("UA").currency).toBe("UAH");
    expect(allowedRates(null, "US")).toEqual([0]);
    expect(allowedRates([8.875, 4], "US")).toEqual([8.875, 4, 0]);
    expect(isBlockedCountry("ru")).toBe(true);
    expect(isBlockedCountry("BY")).toBe(true);
    expect(isBlockedCountry("KZ")).toBe(false);
    expect(parseRate("7,5")).toBe(7.5);
    expect(parseRate("8.875")).toBe(8.875);
    expect(parseRate("abc")).toBeNull();
    expect(validTaxId("DE 123456789", countryProfile("DE").vatIdPattern)).toBe(true);
    expect(validTaxId("DE123", countryProfile("DE").vatIdPattern)).toBe(false);
    expect(validTaxId("12-3456789", countryProfile("US").taxNumberPattern)).toBe(true);
  });

  it("writes money the way the language does in the company's country", () => {
    expect(formatMoney(123450, "en", { country: "US", currency: "USD" })).toBe("$1,234.50");
    expect(formatMoney(123450, "de", { country: "DE", currency: "EUR" })).toMatch(/^1\.234,50\s€$/);
    expect(formatMoney(123450, "kk", { country: "KZ", currency: "KZT" })).toMatch(/^1\s234,50\s₸$/);
  });
});

describe("signing up by country", () => {
  it("sets currency, numbering and time zone from the chosen country", async () => {
    const { organizationId } = await registerAccount(
      { name: "Sam", email: email("us"), password: "long enough password", company: "Acme LLC", country: "us", timezone: "America/Chicago" },
      null,
      "US",
    );
    const ctx = await newCompany("Seed GmbH");
    const [org] = await getDb().query.organizations.findMany({ where: (o, { eq: is }) => is(o.id, organizationId) });
    expect(org).toMatchObject({ country: "US", currency: "USD", timezone: "America/Chicago", invoiceNumberFormat: "INV-{YYYY}-{NNNN}", signupIpCountry: "US" });
    expect(await suspensionOf(organizationId)).toBeNull();
    expect(ctx.organization.currency).toBe("EUR");
  });

  it("refuses Russia, Belarus and Tor, whatever is chosen", async () => {
    const base = { name: "Ivan", password: "long enough password", company: "Firma" };
    await expect(registerAccount({ ...base, email: email("ru"), country: "RU" })).rejects.toThrow();
    await expect(registerAccount({ ...base, email: email("by"), country: "BY" })).rejects.toThrow();
    for (const ip of ["RU", "BY", "T1"]) {
      await expect(registerAccount({ ...base, email: email("ip"), country: "KZ" }, null, ip)).rejects.toMatchObject({ code: "REGION_BLOCKED" });
    }
    await expect(authenticate(email("x"), "whatever", "k", "RU")).rejects.toBeInstanceOf(AccountError);
  });

  it("holds a company for review when it signs up from another country", async () => {
    await newCompany("First GmbH");
    const { organizationId } = await registerAccount(
      { name: "Olga", email: email("kz"), password: "long enough password", company: "Too", country: "KZ" },
      null,
      "NL",
    );
    expect(await suspensionOf(organizationId)).toBe("REVIEW");
  });
});

describe("tax and invoices by country", () => {
  it("lets a US company charge its own sales tax, on Letter paper, in dollars, without XRechnung", async () => {
    const ctx = await newCompany("Acme Inc", "US");
    expect(ctx.organization.currency).toBe("USD");
    const client = await createClient(ctx, { type: "COMPANY", companyName: "Buyer Corp", email: "buyer@example.org" });
    // 19 % is German: refused. Before rates are set, only 0 % is allowed.
    await expect(createInvoiceDraft(ctx, { clientId: client.id, items: [line(100, 19)] })).rejects.toThrow();
    await updateCompany(ctx, { name: "Acme Inc", street: "1 Main St", postalCode: "10001", city: "New York", taxRates: "8.875", taxNumber: "12-3456789" });
    const us = await reload(ctx);
    expect(us.organization.taxRates).toEqual([8.875]);
    const draft = await createInvoiceDraft(us, { clientId: client.id, items: [line(100, 8.875)] });
    expect(draft.vatCents).toBe(888);
    expect(draft.grossCents).toBe(10888);
    const issued = await issueInvoice(us, draft.id);
    const doc = await renderInvoice(us, issued.id);
    const size = (await PDFDocument.load(doc.pdf)).getPage(0).getSize();
    expect([Math.round(size.width), Math.round(size.height)]).toEqual([612, 792]);
    await expect(keepInvoiceFile(us, issued.id, "XRECHNUNG")).rejects.toMatchObject({ code: "NOT_READY", missing: ["sellerCountry"] });
    // Issued: the currency stays.
    await expect(updateCompany(us, { name: "Acme Inc", currency: "EUR" })).rejects.toThrow();
  });

  it("checks tax numbers by the country's shape and asks for one where the country does", async () => {
    const kz = await newCompany("Too Kaz", "KZ");
    await expect(updateCompany(kz, { name: "Too Kaz", taxNumber: "123" })).rejects.toThrow();
    await updateCompany(kz, { name: "Too Kaz", street: "Abay 1", postalCode: "050000", city: "Almaty" });
    const client = await createClient(await reload(kz), { type: "COMPANY", companyName: "Client" });
    expect(client.country).toBe("KZ");
    const draft = await createInvoiceDraft(await reload(kz), { clientId: client.id, items: [line(1000, 16)] });
    await expect(issueInvoice(await reload(kz), draft.id)).rejects.toBeInstanceOf(InvoiceStateError);
    await updateCompany(kz, { name: "Too Kaz", street: "Abay 1", postalCode: "050000", city: "Almaty", taxNumber: "123456789012" });
    expect((await issueInvoice(await reload(kz), draft.id)).status).toBe("ISSUED");

    const de = await newCompany("Prüf GmbH");
    await expect(updateCompany(de, { name: "Prüf GmbH", vatId: "DE123" })).rejects.toThrow();
    await updateCompany(de, { name: "Prüf GmbH", vatId: "DE123456789" });
  });

  it("lets the platform admin correct a country; the currency follows only before the first invoice", async () => {
    const ctx = await newCompany("Wrong Country", "DE");
    const admin = { ...ctx.user, isPlatformAdmin: true };
    await setCompanyCountry(admin, ctx.organization.id, "UA");
    expect((await reload(ctx)).organization).toMatchObject({ country: "UA", currency: "UAH" });
    await expect(setCompanyCountry(admin, ctx.organization.id, "RU")).rejects.toThrow();
  });
});

describe("documents in every language", () => {
  it("renders an invoice in all six languages for a company outside Germany", async () => {
    const ctx = await newCompany("Tbilisi LLC", "GE");
    await updateCompany(ctx, { name: "Tbilisi LLC", street: "Rustaveli 1", postalCode: "0108", city: "Tbilisi", taxNumber: "123456789" });
    const ge = await reload(ctx);
    const client = await createClient(ge, { type: "COMPANY", companyName: "Client" });
    for (const language of ["de", "en", "ru", "uk", "kk", "es"] as const) {
      const draft = await createInvoiceDraft(ge, { clientId: client.id, language, items: [line(250, 18)] });
      const issued = await issueInvoice(ge, draft.id);
      const doc = await renderInvoice(ge, issued.id);
      expect(Buffer.from(doc.pdf.slice(0, 5)).toString()).toBe("%PDF-");
    }
  });
});

describe("payments from closed countries", () => {
  it("holds a company for review when a card from Russia or Belarus is attached", async () => {
    const saved = { key: process.env.STRIPE_SECRET_KEY, hook: process.env.STRIPE_WEBHOOK_SECRET };
    process.env.STRIPE_SECRET_KEY = "sk_test_local";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_test";
    try {
      const ctx = await newCompany("Card GmbH");
      await getDb().update(subscriptions).set({ stripeCustomerId: "cus_card_test" }).where(eq(subscriptions.organizationId, ctx.organization.id));
      const payload = JSON.stringify({
        id: "evt_card_ru",
        object: "event",
        type: "payment_method.attached",
        data: { object: { id: "pm_1", object: "payment_method", customer: "cus_card_test", card: { country: "RU" } } },
      });
      const header = new Stripe("sk_test_local").webhooks.generateTestHeaderString({ payload, secret: "whsec_local_test" });
      expect(await handleStripeWebhook(payload, header)).toBe("ok");
      const [held] = await getDb().select().from(suspensions).where(eq(suspensions.organizationId, ctx.organization.id));
      expect(held).toMatchObject({ kind: "REVIEW", reason: "card RU" });
    } finally {
      process.env.STRIPE_SECRET_KEY = saved.key ?? "";
      process.env.STRIPE_WEBHOOK_SECRET = saved.hook ?? "";
    }
  });
});
