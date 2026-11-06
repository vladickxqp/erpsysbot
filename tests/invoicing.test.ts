import { createServer } from "node:net";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { counters, invoiceDeliveries, invoiceFiles, invoices, organizations } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { availableTreatments, openCents, shownStatus, taxCategory, taxNote, treatmentProblems, type InvoiceLayout } from "@/lib/invoicing";
import { GET as invoiceFile } from "@/app/api/v1/invoices/[id]/files/[kind]/route";
import { POST as issueRoute } from "@/app/api/v1/invoices/[id]/issue/route";
import { POST as sendRoute } from "@/app/api/v1/invoices/[id]/send/route";
import { POST as createRoute } from "@/app/api/v1/invoices/route";
import { createApiKey } from "@/server/api-keys";
import { createClient, type ClientInput } from "@/server/clients";
import { updateCompany } from "@/server/company";
import { contextFor, type Context } from "@/server/context";
import { uploadDir } from "@/server/documents";
import { InvoiceFileError, invoiceHistory, keepInvoiceFile, renderPdf } from "@/server/invoice-files";
import { deleteInvoiceTemplate, listInvoiceTemplates, saveInvoiceTemplate } from "@/server/invoice-templates";
import {
  cancelInvoice,
  createCreditNote,
  createInvoiceDraft,
  duplicateInvoice,
  getInvoice,
  InvoiceStateError,
  issueInvoice,
  listInvoices,
  pdfData,
  recordPayment,
  updateInvoiceDraft,
  type InvoiceInput,
} from "@/server/invoices";
import { setMailSender, type Mail } from "@/server/mail";
import { discountCents, formatNumber, lineNet, numberPeriod, totals, validNumberPattern } from "@/server/money";
import { ForbiddenError } from "@/server/permissions";
import { deleteCompany } from "@/server/privacy";
import { createReminder } from "@/server/reminders";
import { SendError, sendDocument, sendInvoice } from "@/server/send";
import { newCompany, newMember } from "./helpers";

const COMPANY = {
  street: "Hauptstraße 1",
  postalCode: "68159",
  city: "Mannheim",
  email: "rechnung@muster.example",
  phone: "+49 621 123456",
  vatId: "DE123456789",
  taxNumber: "38/123/45678",
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
  bankName: "Commerzbank",
};

async function company(name = "Muster GmbH", extra: Partial<typeof organizations.$inferInsert> = {}): Promise<Context> {
  const ctx = await newCompany(name);
  const [row] = await getDb().update(organizations).set({ ...COMPANY, ...extra }).where(eq(organizations.id, ctx.organization.id)).returning();
  return { ...ctx, organization: row };
}

const line = (description: string, quantity: number, euro: number, vatRate = 19, discountPercent = 0) => ({ description, quantity, unit: "Stk", unitPriceCents: Math.round(euro * 100), vatRate, discountPercent });

const CUSTOMER: ClientInput = { type: "COMPANY", companyName: "Kunde AG", email: "kunde@example.org", street: "Weg 2", postalCode: "10115", city: "Berlin" };
const customer = (ctx: Context, extra: Partial<ClientInput> = {}) => createClient(ctx, { ...CUSTOMER, ...extra }, { allowDuplicate: true });

async function issued(ctx: Context, input: Partial<InvoiceInput> = {}) {
  const client = input.clientId ? { id: input.clientId } : await customer(ctx);
  const draft = await createInvoiceDraft(ctx, { items: [line("Montage", 2, 100)], ...input, clientId: client.id });
  return issueInvoice(ctx, draft.id);
}

afterEach(() => setMailSender(null));

describe("calculations", () => {
  it("adds up lines of several rates with their discounts", () => {
    const lines = [line("A", 3, 19.99, 19, 10), line("B", 1, 7.5, 7), line("C", 2.5, 40, 19), line("D", 1, 10, 0)];
    expect(lineNet(lines[0])).toBe(5397);
    const sum = totals(lines);
    expect(sum.byRate).toEqual([
      { rate: 19, netCents: 15397, vatCents: 2925 },
      { rate: 7, netCents: 750, vatCents: 53 },
      { rate: 0, netCents: 1000, vatCents: 0 },
    ]);
    expect(sum).toMatchObject({ netCents: 17147, vatCents: 2978, grossCents: 20125 });
    expect(discountCents(lines)).toBe(600);
  });

  it("rounds once per rate, not per line", () => {
    const lines = Array.from({ length: 3 }, () => line("x", 1, 0.33));
    // Per line this would be 3 × 6 cents.
    expect(totals(lines).vatCents).toBe(19);
  });

  it("charges no VAT for a small business and keeps the lines' amounts", () => {
    expect(totals([line("x", 2, 100)], true)).toMatchObject({ netCents: 20000, vatCents: 0, grossCents: 20000 });
  });

  it("knows what is left after payments and credit notes", () => {
    expect(openCents({ grossCents: 11900, paidCents: 2000, creditedCents: 3000 })).toBe(6900);
  });
});

describe("tax treatment", () => {
  it("does not assume anything the company did not say", () => {
    expect(availableTreatments("DE", false)).toContain("REVERSE_CHARGE");
    expect(availableTreatments("DE", false)).not.toContain("SMALL_BUSINESS");
    expect(availableTreatments("DE", true)).toEqual(["SMALL_BUSINESS"]);
    expect(availableTreatments("US", false)).toEqual(["STANDARD"]);
  });

  it("maps every treatment to its EN 16931 category and its note", () => {
    expect(taxCategory("STANDARD", 19)).toBe("S");
    expect(taxCategory("STANDARD", 0)).toBe("Z");
    expect(taxCategory("SMALL_BUSINESS", 0)).toBe("E");
    expect(taxCategory("REVERSE_CHARGE", 0)).toBe("AE");
    expect(taxCategory("INTRA_EU", 0)).toBe("K");
    expect(taxCategory("EXPORT", 0)).toBe("G");
    expect(taxCategory("NOT_TAXABLE", 0)).toBe("O");
    expect(taxNote("REVERSE_CHARGE", "de")).toContain("Steuerschuldnerschaft des Leistungsempfängers");
    expect(taxNote("REVERSE_CHARGE", "en")).toContain("Steuerschuldnerschaft des Leistungsempfängers");
    expect(taxNote("SMALL_BUSINESS", "de")).toContain("§ 19 UStG");
    expect(taxNote("EXEMPT", "de", "§ 4 Nr. 14 UStG")).toContain("§ 4 Nr. 14 UStG");
    expect(taxNote("STANDARD", "de")).toBeNull();
  });

  it("names what a treatment needs", () => {
    const seller = { country: "DE", vatId: "DE123456789" };
    expect(treatmentProblems("INTRA_EU", null, { seller, buyer: { country: "FR", vatId: "FR1" } })).toEqual([]);
    expect(treatmentProblems("INTRA_EU", null, { seller, buyer: { country: "FR", vatId: null } })).toEqual(["buyerVatId"]);
    expect(treatmentProblems("INTRA_EU", null, { seller, buyer: { country: "DE", vatId: "DE1" } })).toEqual(["buyerInEu"]);
    expect(treatmentProblems("INTRA_EU", null, { seller, buyer: { country: "CH", vatId: "CHE1" } })).toEqual(["buyerInEu"]);
    expect(treatmentProblems("INTRA_EU", null, { seller: { country: "DE", vatId: null }, buyer: { country: "FR", vatId: "FR1" } })).toEqual(["sellerVatId"]);
    expect(treatmentProblems("EXPORT", null, { seller, buyer: { country: "AT", vatId: null } })).toEqual(["buyerOutsideEu"]);
    expect(treatmentProblems("EXPORT", null, { seller, buyer: { country: "CH", vatId: null } })).toEqual([]);
    expect(treatmentProblems("EXEMPT", " ", { seller, buyer: { country: "DE", vatId: null } })).toEqual(["reason"]);
    expect(treatmentProblems("REVERSE_CHARGE", null, { seller, buyer: { country: "AT", vatId: null } })).toEqual(["buyerVatId"]);
    expect(treatmentProblems("REVERSE_CHARGE", null, { seller, buyer: { country: "DE", vatId: null } })).toEqual([]);
  });

  it("takes the tax off every line under a tax-free treatment", async () => {
    const ctx = await company();
    const client = await customer(ctx, { country: "AT", vatId: "ATU12345678" });
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, taxTreatment: "REVERSE_CHARGE", items: [line("Beratung", 1, 100)] });
    expect(draft).toMatchObject({ netCents: 10000, vatCents: 0, grossCents: 10000, taxTreatment: "REVERSE_CHARGE" });
    expect((await getInvoice(ctx, draft.id)).items[0].vatRate).toBe(0);
  });

  it("makes a small business an exempt invoice whatever is asked for", async () => {
    const ctx = await company("Klein", { smallBusiness: true });
    const client = await customer(ctx);
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 100)] });
    expect(draft).toMatchObject({ taxTreatment: "SMALL_BUSINESS", smallBusiness: true, vatCents: 0 });
    await expect(createInvoiceDraft(ctx, { clientId: client.id, taxTreatment: "STANDARD", items: [line("x", 1, 100)] })).rejects.toThrow();
  });

  it("refuses to issue what the treatment does not allow", async () => {
    const ctx = await company();
    const client = await customer(ctx, { country: "FR" });
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, taxTreatment: "INTRA_EU", items: [line("x", 1, 100)] });
    await expect(issueInvoice(ctx, draft.id)).rejects.toMatchObject({ code: "TAX_TREATMENT", missing: ["buyerVatId"] });
    expect((await getInvoice(ctx, draft.id)).invoice).toMatchObject({ status: "DRAFT", number: null });
  });

  it("refuses a rate the company does not use", async () => {
    const ctx = await company();
    const client = await customer(ctx);
    await expect(createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 100, 13)] })).rejects.toThrow();
  });
});

describe("§ 14 UStG", () => {
  it("wants the buyer's address above the small-amount limit", async () => {
    const ctx = await company();
    const client = await createClient(ctx, { companyName: "Ohne Adresse" });
    const big = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 300)] });
    await expect(issueInvoice(ctx, big.id)).rejects.toMatchObject({ code: "CLIENT_INCOMPLETE", missing: ["street", "postalCode", "city"] });
    const small = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 200)] });
    await expect(issueInvoice(ctx, small.id)).resolves.toMatchObject({ status: "ISSUED" });
  });

  it("wants the seller's address and a tax number", async () => {
    const ctx = await newCompany("Ohne Daten");
    const client = await customer(ctx);
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 10)] });
    await expect(issueInvoice(ctx, draft.id)).rejects.toMatchObject({ code: "COMPANY_INCOMPLETE" });
  });

  it("freezes dates, parties and look when issued", async () => {
    const ctx = await company();
    const template = await saveInvoiceTemplate(ctx, null, { name: "Rot", layout: "MODERN", accentColor: "#b91c1c", paymentInstructions: "Bitte {amount} an uns" });
    const inv = await issued(ctx, { invoiceDate: "2026-03-10", serviceDate: "2026-03-01", serviceEndDate: "2026-03-31", title: "März", templateId: template.id });
    expect(inv).toMatchObject({ issueDate: "2026-03-10", serviceDate: "2026-03-01", serviceEndDate: "2026-03-31", dueDate: "2026-03-24", title: "März" });
    expect(inv.templateSnapshot).toMatchObject({ layout: "MODERN", accentColor: "#b91c1c" });
    expect(inv.sellerSnapshot).toMatchObject({ street: "Hauptstraße 1", iban: COMPANY.iban });
    expect(inv.buyerSnapshot).toMatchObject({ street: "Weg 2", email: "kunde@example.org" });
  });

  it("refuses a due date before the invoice date", async () => {
    const ctx = await company();
    const client = await customer(ctx);
    await expect(createInvoiceDraft(ctx, { clientId: client.id, invoiceDate: "2026-05-10", dueDate: "2026-05-01", items: [line("x", 1, 1)] })).rejects.toThrow();
  });

  it("lets the database refuse any change to an issued invoice", async () => {
    const ctx = await company();
    const inv = await issued(ctx, { title: "Original" });
    const change = (values: Partial<typeof invoices.$inferInsert>) =>
      withTenant(ctx.organization.id, (tx) => tx.update(invoices).set(values).where(eq(invoices.id, inv.id)));
    for (const values of [{ title: "Anders" }, { notes: "x" }, { dueDate: "2030-01-01" }, { language: "en" }, { taxTreatment: "EXEMPT" as const }, { templateSnapshot: {} }, { serviceDate: "2020-01-01" }]) {
      await expect(change(values)).rejects.toThrow();
    }
    await expect(change({ sentAt: new Date() })).resolves.toBeDefined();
  });
});

describe("numbering", () => {
  it("fills the company's format", () => {
    expect(formatNumber("INV-{YYYY}-{NNNN}", 2026, 1)).toBe("INV-2026-0001");
    expect(formatNumber("{YY}{MM}/{NNN}", 2026, 7, 3)).toBe("2603/007");
    expect(numberPeriod("INV-{YYYY}-{NNNN}", "2026-03-10")).toBe("2026");
    expect(numberPeriod("{YY}{MM}/{NNN}", "2026-03-10")).toBe("2026-03");
    expect(numberPeriod("R{NNNNN}", "2026-03-10")).toBe("all");
    expect(validNumberPattern("INV-{YYYY}-{NNNN}")).toBe(true);
    expect(validNumberPattern("INV-{YYYY}")).toBe(false);
    expect(validNumberPattern("INV-{DD}-{NN}")).toBe(false);
  });

  it("counts on within a year and starts over in the next one", async () => {
    const ctx = await company("Nummer", { invoiceNumberFormat: "INV-{YYYY}-{NNNN}" });
    const client = await customer(ctx);
    const on = async (invoiceDate: string) => (await issued(ctx, { clientId: client.id, invoiceDate })).number;
    expect(await on("2026-01-15")).toBe("INV-2026-0001");
    expect(await on("2026-12-31")).toBe("INV-2026-0002");
    expect(await on("2027-01-01")).toBe("INV-2027-0001");
    expect(await on("2026-12-31")).toBe("INV-2026-0003");
  });

  it("never repeats a format without a year", async () => {
    const ctx = await company("Ohne Jahr", { invoiceNumberFormat: "R{NNN}" });
    const client = await customer(ctx);
    expect((await issued(ctx, { clientId: client.id, invoiceDate: "2026-12-31" })).number).toBe("R001");
    expect((await issued(ctx, { clientId: client.id, invoiceDate: "2027-01-01" })).number).toBe("R002");
  });

  it("gives each company its own numbers and credit notes their own", async () => {
    const [a, b] = [await company("Eins"), await company("Zwei")];
    const first = await issued(a, { invoiceDate: "2026-02-01" });
    const second = await issued(b, { invoiceDate: "2026-02-01" });
    expect(first.number).toBe(second.number);
    const note = await cancelInvoice(a, first.id);
    expect(note.number).toMatch(/^GS-\d{4}-0001$/);
  });

  it("passes over a number a changed format leads back to", async () => {
    const ctx = await company("Wechsel", { invoiceNumberFormat: "A-{NNN}" });
    const client = await customer(ctx);
    await issued(ctx, { clientId: client.id });
    await getDb().update(counters).set({ value: 0 }).where(eq(counters.organizationId, ctx.organization.id));
    expect((await issued(ctx, { clientId: client.id })).number).toBe("A-002");
  });

  it("gives parallel issues different numbers without a gap", async () => {
    const ctx = await company("Parallel", { invoiceNumberFormat: "P-{NNN}" });
    const client = await customer(ctx);
    const drafts = await Promise.all(Array.from({ length: 8 }, () => createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 10)] })));
    const done = await Promise.all(drafts.map((d) => issueInvoice(ctx, d.id)));
    expect(done.map((i) => i.number).sort()).toEqual(["P-001", "P-002", "P-003", "P-004", "P-005", "P-006", "P-007", "P-008"]);
  }, 30_000);

  it("protects the numbers in the database as well", async () => {
    const ctx = await company("Index");
    const inv = await issued(ctx);
    const client = await customer(ctx);
    const other = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 1)] });
    await expect(withTenant(ctx.organization.id, (tx) => tx.update(invoices).set({ number: inv.number }).where(eq(invoices.id, other.id)))).rejects.toThrow();
  });
});

describe("the same request twice", () => {
  it("stays one invoice, in a row and at the same time", async () => {
    const ctx = await company();
    const client = await customer(ctx);
    const input = { clientId: client.id, items: [line("x", 1, 10)], requestId: "form-request-1" };
    const first = await createInvoiceDraft(ctx, input);
    expect((await createInvoiceDraft(ctx, input)).id).toBe(first.id);
    const both = await Promise.all([1, 2, 3].map(() => createInvoiceDraft(ctx, { ...input, requestId: "form-request-2" })));
    expect(new Set(both.map((i) => i.id)).size).toBe(1);
    expect((await listInvoices(ctx)).total).toBe(2);
  });

  it("issues a draft once", async () => {
    const ctx = await company();
    const client = await customer(ctx);
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 10)] });
    const results = await Promise.allSettled([issueInvoice(ctx, draft.id), issueInvoice(ctx, draft.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(InvoiceStateError);
  });
});

describe("PDF", () => {
  it("draws every layout in German and English on A4", async () => {
    const ctx = await company();
    const client = await customer(ctx);
    for (const layout of ["CLASSIC", "MODERN", "COMPACT"] as InvoiceLayout[]) {
      const template = await saveInvoiceTemplate(ctx, null, { name: layout, layout, accentColor: layout === "MODERN" ? "#fde047" : "#0f766e", footer: "Geschäftsführung: Erika Muster" });
      for (const language of ["de", "en"] as const) {
        const draft = await createInvoiceDraft(ctx, { clientId: client.id, language, templateId: template.id, title: "Wartung", items: [line("Prüfung Ölförderanlage", 2, 100, 19, 5), line("Handbuch", 1, 20, 7)] });
        const pdf = await renderPdf(ctx, await pdfData(ctx, draft.id));
        const doc = await PDFDocument.load(pdf);
        const { width, height } = doc.getPage(0).getSize();
        expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
      }
    }
  });

  it("goes on to further pages, notes included", async () => {
    const ctx = await company();
    const client = await customer(ctx);
    const items = Array.from({ length: 60 }, (_, i) => line(`Position ${i + 1} mit einer längeren Beschreibung`, 1, 10));
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items, notes: "Hinweis\n".repeat(60) });
    const pdf = await renderPdf(ctx, await pdfData(ctx, draft.id));
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(2);
  });

  it("prints what the font cannot show as a question mark instead of breaking", async () => {
    const ctx = await company();
    const client = await customer(ctx);
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("Emoji 😀 und 中文", 1, 10)] });
    await expect(renderPdf(ctx, await pdfData(ctx, draft.id))).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe("archive", () => {
  it("keeps the PDF of an issued invoice byte for byte", async () => {
    const ctx = await company();
    const template = await saveInvoiceTemplate(ctx, null, { name: "Blau", isDefault: true });
    const inv = await issued(ctx);
    const first = await keepInvoiceFile(ctx, inv.id, "PDF");
    expect(first.name).toBe(`${inv.number}.pdf`);
    await saveInvoiceTemplate(ctx, template.id, { name: "Blau", layout: "MODERN", accentColor: "#000000", isDefault: true });
    await updateCompany(ctx, { name: ctx.organization.name, street: "Neue Straße 9", postalCode: "10115", city: "Berlin", vatId: COMPANY.vatId, iban: COMPANY.iban });
    const later = await keepInvoiceFile((await contextFor(ctx.user))!, inv.id, "PDF");
    expect(later.sha256).toBe(first.sha256);
    const { files } = await invoiceHistory(ctx, inv.id);
    expect(files.filter((f) => f.kind === "PDF")).toHaveLength(1);
  });

  it("notices a file that was changed behind its back", async () => {
    const ctx = await company();
    const inv = await issued(ctx);
    await keepInvoiceFile(ctx, inv.id, "PDF");
    const [row] = await withTenant(ctx.organization.id, (tx) => tx.select().from(invoiceFiles).where(eq(invoiceFiles.invoiceId, inv.id)));
    const file = path.join(uploadDir(), row.storageKey);
    await writeFile(file, Buffer.concat([await readFile(file), Buffer.from("x")]));
    await expect(keepInvoiceFile(ctx, inv.id, "PDF")).rejects.toMatchObject({ code: "DAMAGED" });
  });

  it("does not let anyone change or delete what was kept and sent", async () => {
    const ctx = await company();
    setMailSender(async () => {});
    const inv = await issued(ctx);
    await sendInvoice(ctx, inv.id, { to: "kunde@example.org", format: "PDF" });
    await expect(withTenant(ctx.organization.id, (tx) => tx.update(invoiceFiles).set({ name: "x" }).where(eq(invoiceFiles.invoiceId, inv.id)))).rejects.toThrow();
    await expect(withTenant(ctx.organization.id, (tx) => tx.update(invoiceDeliveries).set({ recipient: "x" }).where(eq(invoiceDeliveries.invoiceId, inv.id)))).rejects.toThrow();
    await expect(withTenant(ctx.organization.id, (tx) => tx.delete(invoiceFiles).where(eq(invoiceFiles.invoiceId, inv.id)))).rejects.toThrow();
    await expect(withTenant(ctx.organization.id, (tx) => tx.delete(invoiceDeliveries).where(eq(invoiceDeliveries.invoiceId, inv.id)))).rejects.toThrow();
  });

  it("gives drafts no archive", async () => {
    const ctx = await company();
    const client = await customer(ctx);
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 1)] });
    await expect(keepInvoiceFile(ctx, draft.id, "PDF")).rejects.toBeInstanceOf(InvoiceFileError);
  });
});

describe("sending", () => {
  const capture = () => {
    const sent: Mail[] = [];
    setMailSender(async (mail) => {
      sent.push(mail);
      return { messageId: `<${sent.length}@test>` };
    });
    return sent;
  };

  it("sends the kept file, notes the date and keeps the history", async () => {
    const ctx = await company();
    const sent = capture();
    const inv = await issued(ctx, { language: "en" });
    await sendInvoice(ctx, inv.id, { to: "Kunde@Example.org" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "kunde@example.org", replyTo: COMPANY.email });
    expect(sent[0].subject).toContain(`Invoice ${inv.number}`);
    const kept = await keepInvoiceFile(ctx, inv.id, "PDF");
    expect(Buffer.from(sent[0].attachments![0].content).equals(Buffer.from(kept.bytes))).toBe(true);
    const { invoice } = await getInvoice(ctx, inv.id);
    expect(invoice.sentAt).toBeInstanceOf(Date);
    expect(shownStatus(invoice, "2026-01-01")).toBe("SENT");
    const { deliveries } = await invoiceHistory(ctx, inv.id);
    expect(deliveries).toMatchObject([{ status: "SENT", recipient: "kunde@example.org", format: "PDF", messageId: "<1@test>", sentBy: ctx.user.userId }]);
  });

  it("never marks an invoice sent when the mail server refuses", async () => {
    const ctx = await company();
    setMailSender(async () => {
      throw new Error("550 mailbox unavailable");
    });
    const inv = await issued(ctx);
    await expect(sendInvoice(ctx, inv.id, { to: "kunde@example.org" })).rejects.toMatchObject({ code: "REFUSED" });
    const { invoice } = await getInvoice(ctx, inv.id);
    expect(invoice.sentAt).toBeNull();
    expect(shownStatus(invoice, "2026-01-01")).toBe("ISSUED");
    const { deliveries } = await invoiceHistory(ctx, inv.id);
    expect(deliveries).toMatchObject([{ status: "FAILED", error: "550 mailbox unavailable" }]);
  });

  it("keeps the first date when an invoice goes out again", async () => {
    const ctx = await company();
    capture();
    const inv = await issued(ctx);
    await sendInvoice(ctx, inv.id, { to: "a@example.org" });
    const { invoice: once } = await getInvoice(ctx, inv.id);
    await sendInvoice(ctx, inv.id, { to: "b@example.org" });
    const { invoice: twice } = await getInvoice(ctx, inv.id);
    expect(twice.sentAt).toEqual(once.sentAt);
    expect((await invoiceHistory(ctx, inv.id)).deliveries).toHaveLength(2);
  });

  it("attaches the structured formats", async () => {
    const ctx = await company();
    const sent = capture();
    const inv = await issued(ctx);
    await sendInvoice(ctx, inv.id, { to: "kunde@example.org", format: "XRECHNUNG" });
    expect(sent[0].attachments?.map((a) => a.contentType)).toEqual(["application/xml", "application/pdf"]);
    await sendInvoice(ctx, inv.id, { to: "kunde@example.org", format: "ZUGFERD" });
    expect(sent[1].attachments).toHaveLength(1);
    expect(sent[1].attachments![0].filename).toContain("zugferd");
  }, 30_000);

  it("uses the company's format, and says so when it cannot be built", async () => {
    const ctx = await company("Format", { einvoiceFormat: "XRECHNUNG", phone: null });
    capture();
    const inv = await issued(ctx);
    await expect(sendInvoice(ctx, inv.id, { to: "kunde@example.org" })).rejects.toMatchObject({ code: "NOT_READY", missing: ["sellerPhone"] });
    expect((await invoiceHistory(ctx, inv.id)).deliveries).toEqual([]);
  });

  it("does not send a draft, or without a mail server", async () => {
    const ctx = await company();
    const client = await customer(ctx);
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 1)] });
    await expect(sendInvoice(ctx, draft.id, { to: "kunde@example.org" })).rejects.toBeInstanceOf(SendError);
    capture();
    await expect(sendInvoice(ctx, draft.id, { to: "kunde@example.org" })).rejects.toMatchObject({ code: "DRAFT" });
    await expect(sendInvoice(ctx, draft.id, { to: "kein-mail" })).rejects.toThrow();
  });

  it("works through sendDocument too", async () => {
    const ctx = await company();
    const sent = capture();
    const inv = await issued(ctx);
    await sendDocument(ctx, "invoice", inv.id, { to: "kunde@example.org" });
    expect(sent).toHaveLength(1);
    expect((await getInvoice(ctx, inv.id)).invoice.sentAt).not.toBeNull();
  });

  it("speaks SMTP with a real server, attachment included", async () => {
    const lines: string[] = [];
    let data = false;
    const server = createServer((socket) => {
      socket.write("220 test ESMTP\r\n");
      socket.on("data", (chunk) => {
        for (const row of chunk.toString("latin1").split("\r\n")) {
          if (data) {
            lines.push(row);
            if (row === ".") {
              data = false;
              socket.write("250 2.0.0 queued as abc\r\n");
            }
          } else if (/^(EHLO|HELO)/i.test(row)) socket.write("250 test\r\n");
          else if (/^(MAIL|RCPT)/i.test(row)) socket.write("250 ok\r\n");
          else if (/^DATA/i.test(row)) {
            data = true;
            socket.write("354 go\r\n");
          } else if (/^QUIT/i.test(row)) socket.end("221 bye\r\n");
        }
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address() as { port: number };
    Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_FROM: "noreply@example.org" });
    try {
      const ctx = await company();
      const inv = await issued(ctx);
      await sendInvoice(ctx, inv.id, { to: "kunde@example.org" });
      const raw = lines.join("\n");
      expect(raw).toContain("kunde@example.org");
      expect(raw).toContain(`filename=${inv.number}.pdf`);
      expect(raw).toContain(`Reply-To: ${COMPANY.email}`);
      expect((await invoiceHistory(ctx, inv.id)).deliveries[0]).toMatchObject({ status: "SENT" });
    } finally {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      delete process.env.SMTP_FROM;
      server.close();
    }
  }, 30_000);
});

describe("credit notes", () => {
  it("takes back part of an invoice, which stays open with less to pay", async () => {
    const ctx = await company();
    const inv = await issued(ctx, { items: [line("Montage", 4, 100), line("Material", 1, 50)] });
    const { items } = await getInvoice(ctx, inv.id);
    const note = await createCreditNote(ctx, inv.id, { reason: "Eine Stunde zu viel", lines: [{ itemId: items[0].id, quantity: 1 }] });
    expect(note).toMatchObject({ kind: "CREDIT_NOTE", status: "ISSUED", correctsId: inv.id, netCents: -10000, vatCents: -1900, grossCents: -11900, notes: "Eine Stunde zu viel" });
    const { invoice } = await getInvoice(ctx, inv.id);
    expect(invoice).toMatchObject({ status: "ISSUED", creditedCents: 11900, grossCents: inv.grossCents });
    expect(openCents(invoice)).toBe(inv.grossCents - 11900);
  });

  it("counts an invoice as credited once all of it is taken back", async () => {
    const ctx = await company();
    const inv = await issued(ctx, { items: [line("Montage", 2, 100)] });
    const { items } = await getInvoice(ctx, inv.id);
    await createCreditNote(ctx, inv.id, { reason: "Teil 1", lines: [{ itemId: items[0].id, quantity: 1 }] });
    await createCreditNote(ctx, inv.id, { reason: "Teil 2", lines: [{ itemId: items[0].id, quantity: 1 }] });
    expect((await getInvoice(ctx, inv.id)).invoice.status).toBe("CREDITED");
    expect((await listInvoices(ctx, { filter: "CREDITED" })).total).toBe(1);
  });

  it("never takes back more than there was", async () => {
    const ctx = await company();
    const inv = await issued(ctx, { items: [line("Montage", 2, 100)] });
    const { items } = await getInvoice(ctx, inv.id);
    await expect(createCreditNote(ctx, inv.id, { reason: "x", lines: [{ itemId: items[0].id, quantity: 3 }] })).rejects.toMatchObject({ code: "OVER_CREDITED" });
    await createCreditNote(ctx, inv.id, { reason: "x", lines: [{ itemId: items[0].id, quantity: 2 }] });
    await expect(createCreditNote(ctx, inv.id, { reason: "x", lines: [{ itemId: items[0].id, quantity: 1 }] })).rejects.toMatchObject({ code: "NOT_CREDITABLE" });
  });

  it("settles an invoice whose rest was paid, and limits payments by what is open", async () => {
    const ctx = await company();
    const inv = await issued(ctx, { items: [line("Montage", 2, 100)] });
    const { items } = await getInvoice(ctx, inv.id);
    await createCreditNote(ctx, inv.id, { reason: "x", lines: [{ itemId: items[0].id, quantity: 1 }] });
    await expect(recordPayment(ctx, inv.id, { amountCents: 11901, paidOn: "2026-02-01" })).rejects.toMatchObject({ code: "OVERPAID" });
    await recordPayment(ctx, inv.id, { amountCents: 11900, paidOn: "2026-02-01" });
    expect((await getInvoice(ctx, inv.id)).invoice.status).toBe("PAID");
  });

  it("reminds of what is really open", async () => {
    const ctx = await company();
    const inv = await issued(ctx, { invoiceDate: "2020-01-01", dueDate: "2020-01-15", items: [line("Montage", 2, 100)] });
    const { items } = await getInvoice(ctx, inv.id);
    await createCreditNote(ctx, inv.id, { reason: "x", lines: [{ itemId: items[0].id, quantity: 1 }] });
    expect((await createReminder(ctx, inv.id)).openCents).toBe(11900);
  });

  it("cancels in one step, with a reason, and not twice", async () => {
    const ctx = await company();
    const inv = await issued(ctx);
    const note = await cancelInvoice(ctx, inv.id, "web", { reason: "Falscher Kunde" });
    expect(note).toMatchObject({ kind: "CREDIT_NOTE", status: "ISSUED", grossCents: -inv.grossCents, notes: "Falscher Kunde" });
    expect((await getInvoice(ctx, inv.id)).invoice.status).toBe("CANCELLED");
    await expect(cancelInvoice(ctx, inv.id)).rejects.toMatchObject({ code: "NOT_CANCELLABLE" });
  });

  it("does not cancel what was partly credited", async () => {
    const ctx = await company();
    const inv = await issued(ctx);
    const { items } = await getInvoice(ctx, inv.id);
    await createCreditNote(ctx, inv.id, { reason: "x", lines: [{ itemId: items[0].id, quantity: 1 }] });
    await expect(cancelInvoice(ctx, inv.id)).rejects.toMatchObject({ code: "NOT_CANCELLABLE" });
  });

  it("leaves nothing behind when numbering fails", async () => {
    const ctx = await company();
    const inv = await issued(ctx);
    const broken: Context = { ...ctx, organization: { ...ctx.organization, street: null } };
    await expect(cancelInvoice(broken, inv.id)).rejects.toMatchObject({ code: "COMPANY_INCOMPLETE" });
    const { invoice, related } = await getInvoice(ctx, inv.id);
    expect(invoice.status).toBe("ISSUED");
    expect(related).toEqual([]);
  });
});

describe("overview", () => {
  it("duplicates into a new draft of its own", async () => {
    const ctx = await company();
    const inv = await issued(ctx, { title: "Wartung", notes: "Danke", items: [line("A", 2, 10, 19, 10), line("B", 1, 5, 7)] });
    const copy = await duplicateInvoice(ctx, inv.id);
    expect(copy).toMatchObject({ status: "DRAFT", number: null, issueDate: null, dueDate: null, title: "Wartung", notes: "Danke", grossCents: inv.grossCents });
    expect(copy.id).not.toBe(inv.id);
    expect((await getInvoice(ctx, copy.id)).items).toHaveLength(2);
    const note = await cancelInvoice(ctx, inv.id);
    await expect(duplicateInvoice(ctx, note.id)).rejects.toBeInstanceOf(InvoiceStateError);
  });

  it("searches, filters and sorts", async () => {
    const ctx = await company("Liste");
    const anna = await customer(ctx, { companyName: "Anna AG" });
    const zoe = await customer(ctx, { companyName: "Zoe AG" });
    const late = await issued(ctx, { clientId: anna.id, invoiceDate: "2020-01-01", dueDate: "2020-02-01", title: "Altlast", items: [line("x", 1, 500)] });
    const paid = await issued(ctx, { clientId: zoe.id, items: [line("x", 1, 100)] });
    await recordPayment(ctx, paid.id, { amountCents: paid.grossCents, paidOn: "2026-02-01" });
    const part = await issued(ctx, { clientId: zoe.id, items: [line("x", 1, 300)] });
    await recordPayment(ctx, part.id, { amountCents: 100, paidOn: "2026-02-01" });
    await createInvoiceDraft(ctx, { clientId: anna.id, items: [line("x", 1, 1)] });
    setMailSender(async () => {});
    const sent = await issued(ctx, { clientId: zoe.id, dueDate: "2099-01-01", invoiceDate: "2098-12-01", items: [line("x", 1, 200)] });
    await sendInvoice(ctx, sent.id, { to: "kunde@example.org" });

    const ids = async (query: Parameters<typeof listInvoices>[1]) => (await listInvoices(ctx, query)).rows.map((r) => r.id);
    expect(await ids({ filter: "OVERDUE" })).toEqual([late.id]);
    expect(await ids({ filter: "PAID" })).toEqual([paid.id]);
    expect(await ids({ filter: "PARTIALLY_PAID" })).toEqual([part.id]);
    expect(await ids({ filter: "SENT" })).toEqual([sent.id]);
    expect((await listInvoices(ctx, { filter: "DRAFT" })).total).toBe(1);
    expect(await ids({ q: "Altlast" })).toEqual([late.id]);
    expect(await ids({ q: late.number! })).toEqual([late.id]);
    const byTotal = (await listInvoices(ctx, { sort: "total", dir: "desc" })).rows.map((r) => r.grossCents);
    expect(byTotal).toEqual([...byTotal].sort((a, b) => b - a));
    expect((await listInvoices(ctx, { sort: "client", dir: "asc" })).rows[0].clientName).toBe("Anna AG");
    expect((await listInvoices(ctx, { sort: "client", dir: "desc" })).rows[0].clientName).toBe("Zoe AG");
    const page = await listInvoices(ctx, { pageSize: 2, page: 2, sort: "total" });
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(5);
    expect((await listInvoices(ctx, { filter: "OVERDUE" })).rows[0]).toMatchObject({ shown: "OVERDUE", overdue: true });
  });
});

describe("templates", () => {
  it("keeps one default, and a new invoice starts from it", async () => {
    const ctx = await company();
    const first = await saveInvoiceTemplate(ctx, null, { name: "Eins", isDefault: true, language: "en" });
    const second = await saveInvoiceTemplate(ctx, null, { name: "Zwei", isDefault: true, language: "en", layout: "COMPACT" });
    const all = await listInvoiceTemplates(ctx);
    expect(all.filter((x) => x.isDefault).map((x) => x.id)).toEqual([second.id]);
    expect(first.id).not.toBe(second.id);
    const client = await customer(ctx);
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 1)] });
    expect(draft).toMatchObject({ templateId: second.id, language: "en" });
  });

  it("refuses a colour or name that is not one and a name twice", async () => {
    const ctx = await company();
    await expect(saveInvoiceTemplate(ctx, null, { name: "x", accentColor: "red" })).rejects.toThrow();
    await expect(saveInvoiceTemplate(ctx, null, { name: " " })).rejects.toThrow();
    await saveInvoiceTemplate(ctx, null, { name: "Eins" });
    await expect(saveInvoiceTemplate(ctx, null, { name: "eins" })).rejects.toMatchObject({ code: "NAME_TAKEN" });
  });

  it("may go while issued invoices keep their look", async () => {
    const ctx = await company();
    const template = await saveInvoiceTemplate(ctx, null, { name: "Weg", layout: "MODERN", accentColor: "#123456" });
    const inv = await issued(ctx, { templateId: template.id });
    await deleteInvoiceTemplate(ctx, template.id);
    const { invoice } = await getInvoice(ctx, inv.id);
    expect(invoice.templateId).toBeNull();
    expect(invoice.templateSnapshot).toMatchObject({ accentColor: "#123456" });
  });

  it("checks numbering formats in the company settings", async () => {
    const ctx = await company();
    await expect(updateCompany(ctx, { name: "Muster GmbH", invoiceNumberFormat: "RE-{YYYY}" })).rejects.toThrow();
    await expect(updateCompany(ctx, { name: "Muster GmbH", creditNoteNumberFormat: "GS-{FOO}-{NN}" })).rejects.toThrow();
    const row = await updateCompany(ctx, { name: "Muster GmbH", invoiceNumberFormat: "INV-{YYYY}-{NNNN}", einvoiceFormat: "ZUGFERD" });
    expect(row).toMatchObject({ invoiceNumberFormat: "INV-{YYYY}-{NNNN}", einvoiceFormat: "ZUGFERD" });
  });
});

describe("two companies", () => {
  it("never see each other's invoices, files, history or templates", async () => {
    const [a, b] = [await company("Alpha"), await company("Beta")];
    setMailSender(async () => {});
    const inv = await issued(a);
    await sendInvoice(a, inv.id, { to: "kunde@example.org" });
    const template = await saveInvoiceTemplate(a, null, { name: "Geheim" });

    await expect(getInvoice(b, inv.id)).rejects.toThrow();
    await expect(pdfData(b, inv.id)).rejects.toThrow();
    await expect(keepInvoiceFile(b, inv.id, "PDF")).rejects.toThrow();
    await expect(sendInvoice(b, inv.id, { to: "x@example.org" })).rejects.toThrow();
    await expect(createCreditNote(b, inv.id, { reason: "x", lines: [{ itemId: inv.id, quantity: 1 }] })).rejects.toThrow();
    await expect(cancelInvoice(b, inv.id)).rejects.toThrow();
    await expect(duplicateInvoice(b, inv.id)).rejects.toThrow();
    expect((await invoiceHistory(b, inv.id)).deliveries).toEqual([]);
    expect((await invoiceHistory(b, inv.id)).files).toEqual([]);
    expect((await listInvoices(b)).total).toBe(0);
    expect(await listInvoiceTemplates(b)).toEqual([]);
    await expect(deleteInvoiceTemplate(b, template.id)).rejects.toThrow();

    const client = await customer(b);
    await expect(createInvoiceDraft(b, { clientId: client.id, templateId: template.id, items: [line("x", 1, 1)] })).rejects.toThrow();
    const stolen = await createInvoiceDraft(a, { clientId: (await customer(a)).id, items: [line("x", 1, 1)] });
    await expect(updateInvoiceDraft(b, stolen.id, { clientId: client.id, items: [line("x", 1, 1)] })).rejects.toThrow();
  });

  it("keeps each company's files in its own folder", async () => {
    const [a, b] = [await company("Ordner A"), await company("Ordner B")];
    const [x, y] = [await issued(a), await issued(b)];
    await keepInvoiceFile(a, x.id, "PDF");
    await keepInvoiceFile(b, y.id, "PDF");
    const key = async (ctx: Context, id: string) => (await withTenant(ctx.organization.id, (tx) => tx.select().from(invoiceFiles).where(eq(invoiceFiles.invoiceId, id))))[0].storageKey;
    expect(await key(a, x.id)).toMatch(new RegExp(`^${a.organization.id}/invoices/`));
    expect(await key(b, y.id)).toMatch(new RegExp(`^${b.organization.id}/invoices/`));
  });
});

describe("permissions", () => {
  it("follows the roles", async () => {
    const owner = await company();
    const inv = await issued(owner);
    const client = await customer(owner);
    const { items } = await getInvoice(owner, inv.id);
    const viewer = await newMember(owner, "VIEWER");
    const employee = await newMember(owner, "EMPLOYEE");
    const manager = await newMember(owner, "MANAGER");
    const accountant = await newMember(owner, "ACCOUNTANT");
    const refused = async (work: Promise<unknown>) => expect(work).rejects.toBeInstanceOf(ForbiddenError);

    await refused(getInvoice(viewer, inv.id));
    await refused(listInvoices(employee));
    await refused(keepInvoiceFile(viewer, inv.id, "PDF"));
    await refused(createInvoiceDraft(viewer, { clientId: client.id, items: [line("x", 1, 1)] }));

    const draft = await createInvoiceDraft(manager, { clientId: client.id, items: [line("x", 1, 1)] });
    await refused(issueInvoice(manager, draft.id));
    await refused(cancelInvoice(manager, inv.id));
    await refused(createCreditNote(manager, inv.id, { reason: "x", lines: [{ itemId: items[0].id, quantity: 1 }] }));
    await refused(saveInvoiceTemplate(manager, null, { name: "x" }));
    await refused(saveInvoiceTemplate(accountant, null, { name: "x" }));

    await expect(issueInvoice(accountant, draft.id)).resolves.toMatchObject({ status: "ISSUED" });
    await expect(createCreditNote(accountant, inv.id, { reason: "x", lines: [{ itemId: items[0].id, quantity: 1 }] })).resolves.toMatchObject({ kind: "CREDIT_NOTE" });
  });

  it("writes every step to the audit log", async () => {
    const ctx = await company();
    setMailSender(async () => {});
    const inv = await issued(ctx);
    await sendInvoice(ctx, inv.id, { to: "kunde@example.org" });
    setMailSender(async () => {
      throw new Error("down");
    });
    await sendInvoice(ctx, inv.id, { to: "kunde@example.org" }).catch(() => {});
    await duplicateInvoice(ctx, inv.id);
    const rows = await withTenant(ctx.organization.id, (tx) => tx.execute(sql`select action from audit_log where entity = 'invoice'`));
    const list = (rows as unknown as { rows?: { action: string }[] }).rows ?? (rows as unknown as { action: string }[]);
    const actions = list.map((r) => r.action);
    for (const action of ["invoice.draft", "invoice.issue", "invoice.file", "invoice.send", "invoice.send_failed", "invoice.duplicate"]) expect(actions).toContain(action);
  });
});

describe("API", () => {
  const call = (key: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Request("http://local/api", { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("writes, issues, sends and hands out an invoice, once", async () => {
    const ctx = await company();
    const sent: Mail[] = [];
    setMailSender(async (mail) => {
      sent.push(mail);
    });
    const client = await customer(ctx);
    const key = await createApiKey(ctx, "Shop", true);
    const body = { clientId: client.id, title: "Bestellung 7", items: [line("Ware", 1, 100)] };
    const first = await (await createRoute(call(key, body, { "idempotency-key": "bestellung-7" }))).json();
    const second = await (await createRoute(call(key, body, { "idempotency-key": "bestellung-7" }))).json();
    expect(second.data.id).toBe(first.data.id);

    const id = first.data.id as string;
    expect((await invoiceFile(call(key), { params: Promise.resolve({ id, kind: "pdf" }) })).status).toBe(409);
    const done = await (await issueRoute(call(key, {}), params(id))).json();
    expect(done.data.number).toMatch(/^RE-/);
    expect((await sendRoute(call(key, { to: "kunde@example.org", format: "PDF" }), params(id))).status).toBe(200);
    expect(sent).toHaveLength(1);
    const file = await invoiceFile(call(key), { params: Promise.resolve({ id, kind: "xrechnung" }) });
    expect(file.status).toBe(200);
    expect(await file.text()).toContain("xrechnung_3.0");
    expect((await invoiceFile(call(key), { params: Promise.resolve({ id, kind: "exe" }) })).status).toBe(404);
  }, 30_000);

  it("answers 409 with what is missing, 502 when the mail server refuses, 401 and 404 for strangers", async () => {
    const ctx = await company();
    const stranger = await company("Fremd");
    const key = await createApiKey(ctx, "Shop", true);
    const client = await createClient(ctx, { companyName: "Ohne Adresse" });
    const big = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 300)] });
    const refused = await issueRoute(call(key, {}), params(big.id));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "CLIENT_INCOMPLETE", missing: ["street", "postalCode", "city"] });

    setMailSender(async () => {
      throw new Error("down");
    });
    const inv = await issued(ctx);
    expect((await sendRoute(call(key, { to: "kunde@example.org" }), params(inv.id))).status).toBe(502);
    expect((await issueRoute(call("nx_falsch", {}), params(inv.id))).status).toBe(401);
    const other = await createApiKey(stranger, "Fremd", true);
    expect((await invoiceFile(call(other), { params: Promise.resolve({ id: inv.id, kind: "pdf" }) })).status).toBe(404);
  });
});

describe("deleting a company", () => {
  it("takes its invoices, history and files along, and nothing else", async () => {
    const ctx = await company("Weg damit");
    const other = await company("Bleibt");
    setMailSender(async () => {});
    const inv = await issued(ctx);
    await sendInvoice(ctx, inv.id, { to: "kunde@example.org" });
    await saveInvoiceTemplate(ctx, null, { name: "Vorlage", isDefault: true });
    const kept = await issued(other);
    await keepInvoiceFile(other, kept.id, "PDF");
    const [file] = await withTenant(ctx.organization.id, (tx) => tx.select().from(invoiceFiles).where(eq(invoiceFiles.invoiceId, inv.id)));

    await deleteCompany(ctx, "Weg damit", "correct horse battery");

    expect(await getDb().select().from(invoices).where(eq(invoices.organizationId, ctx.organization.id))).toEqual([]);
    expect(await getDb().select().from(invoiceFiles).where(eq(invoiceFiles.organizationId, ctx.organization.id))).toEqual([]);
    expect(await getDb().select().from(invoiceDeliveries).where(eq(invoiceDeliveries.organizationId, ctx.organization.id))).toEqual([]);
    await expect(access(path.join(uploadDir(), file.storageKey))).rejects.toThrow();
    await expect(keepInvoiceFile(other, kept.id, "PDF")).resolves.toBeDefined();
  });
});

describe("the words on a document", () => {
  it("leave no placeholder behind", async () => {
    const { DOCUMENT_LABELS, fill } = await import("@/lib/document-labels");
    expect(fill(DOCUMENT_LABELS.de.vatOn, { rate: "19", net: "100,00 €" })).toBe("USt. 19 % auf 100,00 €");
    expect(fill(DOCUMENT_LABELS.en.pay, { amount: "€1.00", due: "1 Jan" })).toBe("Please pay €1.00 by 1 Jan, quoting the invoice number.");
    expect(fill("{amount} / {unknown}", { amount: "1" })).toBe("1 / {unknown}");
    for (const words of Object.values(DOCUMENT_LABELS)) expect(Object.keys(words)).toEqual(Object.keys(DOCUMENT_LABELS.de));
  });
});
