import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { invoices } from "@/db/schema";
import { createClient } from "@/server/clients";
import { invoiceStats, openOrderStats } from "@/server/dashboard";
import { updateCompany } from "@/server/company";
import type { Context } from "@/server/context";
import { contextFor } from "@/server/context";
import { createTransaction, financeSummary, monthlyFlow } from "@/server/finance";
import {
  cancelInvoice,
  createInvoiceDraft,
  getInvoice,
  invoiceFromOrder,
  InvoiceStateError,
  issueInvoice,
  listInvoices,
  recordPayment,
  updateInvoiceDraft,
} from "@/server/invoices";
import { formatNumber, lineNet, parseMoney, today, totals } from "@/server/money";
import { createOrder, getOrder, listOrders } from "@/server/orders";
import { ForbiddenError } from "@/server/permissions";
import { newCompany, newMember } from "./helpers";

async function withCompanyData(ctx: Context): Promise<Context> {
  await updateCompany(ctx, {
    name: ctx.organization.name,
    street: "Hauptstraße 1",
    postalCode: "68159",
    city: "Mannheim",
    taxNumber: "38/123/45678",
    iban: "DE89 3704 0044 0532 0130 00",
  });
  return (await contextFor(ctx.user))!;
}

const line = (description: string, quantity: number, priceEur: number, vatRate = 19, discountPercent = 0) => ({
  description,
  quantity,
  unit: "Stk",
  unitPriceCents: Math.round(priceEur * 100),
  discountPercent,
  vatRate,
});

describe("money", () => {
  it("rounds each line once and VAT once per rate", () => {
    expect(lineNet(line("x", 3, 0.333))).toBe(99); // 0.333 € is 33 ct a piece
    const sum = totals([line("A", 1, 100), line("B", 2, 10, 7), line("C", 1, 50, 19, 10)]);
    expect(sum.byRate).toEqual([
      { rate: 19, netCents: 14500, vatCents: 2755 },
      { rate: 7, netCents: 2000, vatCents: 140 },
    ]);
    expect(sum.grossCents).toBe(14500 + 2000 + 2755 + 140);
    expect(totals([line("A", 1, 100)], true)).toMatchObject({ vatCents: 0, grossCents: 10000 });
  });

  it("reads amounts the way people type them", () => {
    expect(parseMoney("1.234,56 €")).toBe(123456);
    expect(parseMoney("1234.5")).toBe(123450);
    expect(parseMoney("12")).toBe(1200);
    expect(parseMoney("0,99")).toBe(99);
    expect(parseMoney("abc")).toBeNull();
  });

  it("numbers invoices by pattern", () => {
    expect(formatNumber("RE-{YYYY}-{NNNN}", 2026, 7)).toBe("RE-2026-0007");
    expect(formatNumber("{YY}{NNN}", 2026, 42)).toBe("26042");
  });
});

describe("orders", () => {
  it("stores lines and totals and finds orders by client name", async () => {
    const ctx = await newCompany("Order GmbH");
    const client = await createClient(ctx, { companyName: "Bäckerei Krause" });
    const order = await createOrder(ctx, { clientId: client.id, title: "Elektrik Laden", items: [line("Montage", 4, 55), line("Kabel", 20, 1.5)] });
    expect(order.number).toBe(1);
    expect(order.netCents).toBe(4 * 5500 + 20 * 150);
    const { items, clientName } = await getOrder(ctx, order.id);
    expect(items.map((i) => i.description)).toEqual(["Montage", "Kabel"]);
    expect(clientName).toBe("Bäckerei Krause");
    expect((await listOrders(ctx, { q: "krause" })).total).toBe(1);
    expect((await listOrders(ctx, { status: "OPEN" })).total).toBe(1);
  });

  it("refuses a client of another company", async () => {
    const a = await newCompany("Order A GmbH");
    const b = await newCompany("Order B GmbH");
    const foreign = await createClient(b, { lastName: "Fremd" });
    await expect(createOrder(a, { clientId: foreign.id, items: [line("x", 1, 1)] })).rejects.toThrow();
  });
});

describe("invoices", () => {
  it("issues with a gapless yearly number, frozen parties, and protects the result in the database", async () => {
    const ctx = await withCompanyData(await newCompany("Rechnung GmbH"));
    const client = await createClient(ctx, { companyName: "Kunde AG", street: "Weg 2", postalCode: "10115", city: "Berlin" });
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("Beratung", 2, 100)] });
    expect(draft.number).toBeNull();
    await updateInvoiceDraft(ctx, draft.id, { clientId: client.id, items: [line("Beratung", 3, 100)] });

    const issued = await issueInvoice(ctx, draft.id);
    const year = today().slice(0, 4);
    expect(issued.number).toBe(`RE-${year}-0001`);
    expect(issued.grossCents).toBe(35700);
    expect(issued.buyerSnapshot).toMatchObject({ name: "Kunde AG", city: "Berlin" });
    expect(issued.sellerSnapshot).toMatchObject({ city: "Mannheim", taxNumber: "38/123/45678" });

    // No more edits — through the service …
    await expect(updateInvoiceDraft(ctx, draft.id, { clientId: client.id, items: [line("x", 1, 1)] })).rejects.toBeInstanceOf(
      InvoiceStateError,
    );
    // … and not even by going around it.
    const refused = (work: Promise<unknown>) =>
      work.then(
        () => "allowed",
        (e: { message?: string; cause?: { message?: string } }) => String(e.cause?.message ?? e.message),
      );
    expect(
      await refused(withTenant(ctx.organization.id, (tx) => tx.update(invoices).set({ grossCents: 1 }).where(sql`id = ${draft.id}`))),
    ).toMatch(/cannot be changed/);
    expect(await refused(withTenant(ctx.organization.id, (tx) => tx.delete(invoices).where(sql`id = ${draft.id}`)))).toMatch(
      /cannot be deleted/,
    );

    const second = await issueInvoice(ctx, (await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 10)] })).id);
    expect(second.number).toBe(`RE-${year}-0002`);
  });

  it("will not issue before the company names its address and tax number", async () => {
    const ctx = await newCompany("Leer GmbH");
    const client = await createClient(ctx, { lastName: "Kunde" });
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 10)] });
    await expect(issueInvoice(ctx, draft.id)).rejects.toMatchObject({
      code: "COMPANY_INCOMPLETE",
      missing: ["street", "postalCode", "city", "taxNumber"],
    });
  });

  it("books payments into the invoice and into finance", async () => {
    const ctx = await withCompanyData(await newCompany("Zahlung GmbH"));
    const client = await createClient(ctx, { lastName: "Zahler" });
    const inv = await issueInvoice(ctx, (await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 100)] })).id);
    await recordPayment(ctx, inv.id, { amountCents: 5000, paidOn: today() });
    expect((await getInvoice(ctx, inv.id)).invoice.status).toBe("PARTIALLY_PAID");
    await expect(recordPayment(ctx, inv.id, { amountCents: 99999, paidOn: today() })).rejects.toMatchObject({ code: "OVERPAID" });
    await recordPayment(ctx, inv.id, { amountCents: 6900, paidOn: today() });
    const done = await getInvoice(ctx, inv.id);
    expect(done.invoice.status).toBe("PAID");
    expect(done.payments).toHaveLength(2);
    const month = today().slice(0, 8) + "01";
    expect((await financeSummary(ctx, month, today())).incomeCents).toBe(11900);
  });

  it("cancels with a mirrored credit note, never by editing", async () => {
    const ctx = await withCompanyData(await newCompany("Storno GmbH"));
    const client = await createClient(ctx, { lastName: "Storno" });
    const inv = await issueInvoice(ctx, (await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 2, 50)] })).id);
    const note = await cancelInvoice(ctx, inv.id);
    expect(note.kind).toBe("CREDIT_NOTE");
    expect(note.number).toBe(`GS-${today().slice(0, 4)}-0001`);
    expect(note.grossCents).toBe(-inv.grossCents);
    expect(note.correctsId).toBe(inv.id);
    const original = await getInvoice(ctx, inv.id);
    expect(original.invoice.status).toBe("CANCELLED");
    expect(original.related.map((r) => r.number)).toEqual([note.number]);
    await expect(cancelInvoice(ctx, inv.id)).rejects.toMatchObject({ code: "NOT_CANCELLABLE" });
  });

  it("turns an order into a draft with its lines and finds overdue invoices", async () => {
    const ctx = await withCompanyData(await newCompany("Auftrag GmbH"));
    const client = await createClient(ctx, { lastName: "Auftrag" });
    const order = await createOrder(ctx, { clientId: client.id, items: [line("Arbeit", 3, 40)] });
    const draft = await invoiceFromOrder(ctx, order.id);
    expect(draft.orderId).toBe(order.id);
    expect(draft.netCents).toBe(12000);
    const late = await createInvoiceDraft(ctx, { clientId: client.id, dueDate: "2020-01-31", items: [line("x", 1, 10)] });
    await issueInvoice(ctx, late.id);
    expect((await listInvoices(ctx, { filter: "OVERDUE" })).total).toBe(1);
    expect((await listInvoices(ctx, { filter: "DRAFT" })).total).toBe(1);
  });

  it("lets only those with the right issue invoices", async () => {
    const owner = await withCompanyData(await newCompany("Rechte GmbH"));
    const manager = await newMember(owner, "MANAGER");
    const client = await createClient(owner, { lastName: "R" });
    const draft = await createInvoiceDraft(manager, { clientId: client.id, items: [line("x", 1, 10)] });
    await expect(issueInvoice(manager, draft.id)).rejects.toBeInstanceOf(ForbiddenError);
    const accountant = await newMember(owner, "ACCOUNTANT");
    expect((await issueInvoice(accountant, draft.id)).status).toBe("ISSUED");
  });
});

describe("finance", () => {
  it("adds up income, expenses and the result per period and month", async () => {
    const ctx = await newCompany("Finanz GmbH");
    const day = today();
    await createTransaction(ctx, { type: "INCOME", amountCents: 100000, bookedOn: day, category: "cash" });
    await createTransaction(ctx, { type: "EXPENSE", amountCents: 30000, bookedOn: day, category: "rent" });
    await createTransaction(ctx, { type: "REFUND", amountCents: 5000, bookedOn: day });
    await expect(createTransaction(ctx, { type: "EXPENSE", amountCents: -5, bookedOn: day })).rejects.toThrow();
    const sum = await financeSummary(ctx, day.slice(0, 8) + "01", day);
    expect(sum).toMatchObject({ incomeCents: 100000, expenseCents: 30000, refundCents: 5000, resultCents: 65000 });
    const flow = await monthlyFlow(ctx);
    expect(flow.at(-1)).toMatchObject({ income: 95000, expense: 30000 });
  });
});

describe("dashboard", () => {
  it("shows what clients owe, what is late and what is still open", async () => {
    const ctx = await withCompanyData(await newCompany("Übersicht GmbH"));
    const client = await createClient(ctx, { lastName: "Kunde" });
    const paidLate = await issueInvoice(ctx, (await createInvoiceDraft(ctx, { clientId: client.id, dueDate: "2020-01-31", items: [line("x", 1, 100)] })).id);
    await recordPayment(ctx, paidLate.id, { amountCents: 1900, paidOn: today() });
    await issueInvoice(ctx, (await createInvoiceDraft(ctx, { clientId: client.id, items: [line("y", 1, 10)] })).id);
    await createInvoiceDraft(ctx, { clientId: client.id, items: [line("Entwurf", 1, 500)] });
    await createOrder(ctx, { clientId: client.id, items: [line("Arbeit", 2, 50)] });
    expect(await invoiceStats(ctx)).toEqual({ outstandingCents: 10000 + 1190, outstanding: 2, overdue: 1, overdueCents: 10000 });
    expect(await openOrderStats(ctx)).toEqual({ count: 1, netCents: 10000 });
  });
});
