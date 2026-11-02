import { afterEach, describe, expect, it } from "vitest";
import { createClient, listClients } from "@/server/clients";
import { updateCompany } from "@/server/company";
import type { Context } from "@/server/context";
import { contextFor } from "@/server/context";
import { importClients, parseCsv } from "@/server/import";
import { createInvoiceDraft, issueInvoice } from "@/server/invoices";
import { setMailSender, type Mail } from "@/server/mail";
import { today } from "@/server/money";
import { getOrder } from "@/server/orders";
import { createQuote, getQuote, quoteToInvoice, quoteToOrder, setQuoteStatus, updateQuote } from "@/server/quotes";
import { createReminder, listReminders } from "@/server/reminders";
import { renderQuote, renderReminder, sendDocument } from "@/server/send";
import { sendDigests } from "@/server/telegram/digest";
import { createLinkToken, redeemLinkToken, setNotify } from "@/server/telegram/links";
import { newCompany } from "./helpers";

async function withCompanyData(ctx: Context): Promise<Context> {
  await updateCompany(ctx, { name: ctx.organization.name, street: "Hauptstraße 1", postalCode: "68159", city: "Mannheim", taxNumber: "38/123/45678" });
  return (await contextFor(ctx.user))!;
}

const line = (description: string, quantity: number, priceEur: number) => ({ description, quantity, unit: "Stk", unitPriceCents: Math.round(priceEur * 100), discountPercent: 0, vatRate: 19 });

async function overdueInvoice(ctx: Context, email = "kunde@example.org") {
  const client = await createClient(ctx, { companyName: `Kunde ${Math.random()}`, email });
  const draft = await createInvoiceDraft(ctx, { clientId: client.id, dueDate: "2020-01-31", items: [line("Arbeit", 1, 100)] });
  return issueInvoice(ctx, draft.id);
}

describe("quotes", () => {
  it("numbers, edits and turns a quote into an order and an invoice draft, once each", async () => {
    const ctx = await withCompanyData(await newCompany("Angebot GmbH"));
    const client = await createClient(ctx, { lastName: "Kunde" });
    const quote = await createQuote(ctx, { clientId: client.id, title: "Küche", items: [line("Montage", 2, 50)] });
    expect(quote.number).toBe(`AN-${today().slice(0, 4)}-0001`);
    expect(quote.grossCents).toBe(11900);
    await updateQuote(ctx, quote.id, { clientId: client.id, title: "Küche", items: [line("Montage", 3, 50)] });

    const order = await quoteToOrder(ctx, quote.id);
    const { items } = await getOrder(ctx, order.id);
    expect(items.map((i) => Number(i.quantity))).toEqual([3]);
    await expect(quoteToOrder(ctx, quote.id)).rejects.toMatchObject({ code: "CONVERTED" });
    const invoice = await quoteToInvoice(ctx, quote.id);
    expect(invoice.grossCents).toBe(17850);
    expect((await getQuote(ctx, quote.id)).quote).toMatchObject({ status: "ACCEPTED", orderId: order.id, invoiceId: invoice.id });
    await expect(updateQuote(ctx, quote.id, { clientId: client.id, items: [line("x", 1, 1)] })).rejects.toMatchObject({ code: "CLOSED" });

    const declined = await createQuote(ctx, { clientId: client.id, items: [line("x", 1, 1)] });
    await setQuoteStatus(ctx, declined.id, "DECLINED");
    await expect(quoteToOrder(ctx, declined.id)).rejects.toMatchObject({ code: "CLOSED" });
    const pdf = await renderQuote(ctx, quote.id);
    expect(Buffer.from(pdf.pdf.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

describe("reminders", () => {
  it("escalates an overdue invoice up to the third level, never a paid or current one", async () => {
    const ctx = await withCompanyData(await newCompany("Mahnung GmbH"));
    const invoice = await overdueInvoice(ctx);
    for (const level of [1, 2, 3]) expect((await createReminder(ctx, invoice.id)).level).toBe(level);
    await expect(createReminder(ctx, invoice.id)).rejects.toMatchObject({ code: "MAX_LEVEL" });
    const [first] = await listReminders(ctx, invoice.id);
    expect(first.openCents).toBe(11900);
    expect(Buffer.from((await renderReminder(ctx, first.id)).pdf.slice(0, 5)).toString()).toBe("%PDF-");

    const client = await createClient(ctx, { lastName: "Pünktlich" });
    const current = await issueInvoice(ctx, (await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 10)] })).id);
    await expect(createReminder(ctx, current.id)).rejects.toMatchObject({ code: "NOT_OVERDUE" });
  });
});

describe("sending", () => {
  afterEach(() => setMailSender(null));

  it("e-mails the PDF, refuses drafts and marks quotes and reminders as sent", async () => {
    const sent: Mail[] = [];
    setMailSender(async (m) => void sent.push(m));
    const ctx = await withCompanyData(await newCompany("Versand GmbH"));
    const invoice = await overdueInvoice(ctx);
    await sendDocument(ctx, "invoice", invoice.id, { to: "kunde@example.org" });
    expect(sent[0].attachments?.[0].filename).toBe(`${invoice.number}.pdf`);
    expect(sent[0].subject).toContain(invoice.number!);

    const client = await createClient(ctx, { lastName: "Entwurf" });
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 10)] });
    await expect(sendDocument(ctx, "invoice", draft.id, { to: "a@example.org" })).rejects.toMatchObject({ code: "DRAFT" });

    const quote = await createQuote(ctx, { clientId: client.id, items: [line("x", 1, 10)] });
    await sendDocument(ctx, "quote", quote.id, { to: "a@example.org", message: "Hallo" });
    expect((await getQuote(ctx, quote.id)).quote.status).toBe("SENT");
    expect(sent.at(-1)?.text).toBe("Hallo");

    const reminder = await createReminder(ctx, invoice.id);
    await sendDocument(ctx, "reminder", reminder.id, { to: "kunde@example.org" });
    expect((await listReminders(ctx, invoice.id))[0].sentAt).not.toBeNull();
  });
});

describe("csv import", () => {
  it("reads quotes, semicolons and German headers; skips duplicates and reports bad rows", async () => {
    expect(parseCsv('Name;Notiz\r\n"Müller; Sohn";"sagt ""hallo"""\n')).toEqual([
      ["Name", "Notiz"],
      ["Müller; Sohn", 'sagt "hallo"'],
    ]);
    const ctx = await newCompany("Import GmbH");
    await createClient(ctx, { lastName: "Alt", email: "alt@example.org" });
    const csv = ["Firma;Vorname;Nachname;E-Mail;PLZ;Ort;Lieblingsfarbe", "Bau AG;;;bau@example.org;68159;Mannheim;rot", ";Anna;Schmidt;anna@example.org;;Berlin;", ";Bert;Alt;alt@example.org;;;", ";Kaputt;Mail;keine-mail;;;"].join("\n");
    const result = await importClients(ctx, csv);
    expect(result).toMatchObject({ created: 2, skipped: 1, unknownColumns: ["Lieblingsfarbe"] });
    expect(result.failed).toEqual([{ line: 5, reason: "email" }]);
    expect((await listClients(ctx, { q: "Bau" })).rows[0]).toMatchObject({ type: "COMPANY", city: "Mannheim", source: "Import" });
  });
});

describe("morning summary", () => {
  it("goes out once a day from 8 o'clock, only with something to say and only when wanted", async () => {
    const ctx = await withCompanyData(await newCompany("Morgen GmbH"));
    const tgId = String(Date.now());
    await redeemLinkToken(await createLinkToken(ctx.user.userId, ctx.organization.id), { userId: tgId, chatId: tgId, username: null });
    const messages: { chatId: string; text: string }[] = [];
    const send = async (chatId: string, text: string) => void messages.push({ chatId, text });
    const at = (hour: number) => new Date(`2030-03-04T${String(hour - 1).padStart(2, "0")}:30:00Z`); // Berlin = UTC+1 in March

    await overdueInvoice(ctx);
    await sendDigests(send, at(7));
    expect(messages.filter((m) => m.chatId === tgId)).toHaveLength(0);
    await sendDigests(send, at(9));
    const mine = messages.filter((m) => m.chatId === tgId);
    expect(mine).toHaveLength(1);
    expect(mine[0].text).toContain("Morgen GmbH");
    expect(mine[0].text).toContain("überfällige Rechnungen");
    await sendDigests(send, at(10));
    expect(messages.filter((m) => m.chatId === tgId)).toHaveLength(1);

    await setNotify(ctx.user.userId, false);
    await sendDigests(send, new Date("2030-03-05T09:00:00Z"));
    expect(messages.filter((m) => m.chatId === tgId)).toHaveLength(1);
  });
});
