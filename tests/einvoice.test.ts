import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import type { TaxTreatment } from "@/lib/invoicing";
import { createClient, type ClientInput } from "@/server/clients";
import type { Context } from "@/server/context";
import { einvoiceProblems, xrechnungCii, xrechnungXml } from "@/server/einvoice";
import { InvoiceFileError, keepInvoiceFile } from "@/server/invoice-files";
import { cancelInvoice, createCreditNote, createInvoiceDraft, getInvoice, issueInvoice, pdfData, type InvoiceInput } from "@/server/invoices";
import { newCompany } from "./helpers";

/**
 * The files of every kind of invoice. With EINVOICE_SAMPLES set they are also
 * written there: CI hands them to the official validators (.github/workflows/ci.yml).
 */
const samples = process.env.EINVOICE_SAMPLES;

function keep(name: string, bytes: string | Uint8Array) {
  if (!samples) return;
  mkdirSync(samples, { recursive: true });
  writeFileSync(path.join(samples, name), bytes);
}

const SELLER = {
  legalName: "Muster Werkstatt GmbH",
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

async function company(extra: Partial<typeof organizations.$inferInsert> = {}): Promise<Context> {
  const ctx = await newCompany("Muster Werkstatt GmbH");
  const [row] = await getDb().update(organizations).set({ ...SELLER, ...extra }).where(eq(organizations.id, ctx.organization.id)).returning();
  return { ...ctx, organization: row };
}

const line = (description: string, quantity: number, euro: number, vatRate = 19, discountPercent = 0) => ({
  description,
  quantity,
  unit: "Std",
  unitPriceCents: euro * 100,
  vatRate,
  discountPercent,
});

const BUYER: ClientInput = { type: "COMPANY", companyName: "Kunde AG", firstName: "Anna", lastName: "Kunz", email: "einkauf@kunde.example", street: "Weg 2", postalCode: "10115", city: "Berlin", vatId: "DE987654321" };

async function issued(ctx: Context, client: ClientInput, invoice: Partial<InvoiceInput>) {
  const created = await createClient(ctx, client, { allowDuplicate: true });
  const draft = await createInvoiceDraft(ctx, { clientId: created.id, serviceDate: "2026-10-30", items: [line("Montage", 2, 95)], ...invoice });
  return issueInvoice(ctx, draft.id);
}

async function writeAll(ctx: Context, name: string, id: string) {
  const data = await pdfData(ctx, id);
  expect(einvoiceProblems(data)).toEqual([]);
  const ubl = (await keepInvoiceFile(ctx, id, "XRECHNUNG")).bytes;
  keep(`${name}.ubl.xml`, ubl);
  keep(`${name}.cii.xml`, await xrechnungCii(data));
  const zugferd = await keepInvoiceFile(ctx, id, "ZUGFERD");
  keep(`${name}.zugferd.pdf`, zugferd.bytes);
  return { xml: new TextDecoder().decode(ubl), pdf: zugferd.bytes };
}

const CASES: { name: string; treatment: TaxTreatment; client?: Partial<ClientInput>; invoice?: Partial<InvoiceInput>; category: string; text?: RegExp }[] = [
  { name: "standard-mixed-rates", treatment: "STANDARD", invoice: { items: [line("Montage", 2.5, 95), line("Fachbuch", 1, 30, 7), line("Spende", 1, 10, 0)] }, category: "S" },
  { name: "discount", treatment: "STANDARD", invoice: { items: [line("Beratung", 3, 120, 19, 10), line("Material", 7, 3, 19, 2.5)] }, category: "S" },
  { name: "service-period", treatment: "STANDARD", invoice: { serviceDate: "2026-10-01", serviceEndDate: "2026-10-31", title: "Wartung Oktober", notes: "Vielen Dank!" }, category: "S" },
  { name: "reverse-charge", treatment: "REVERSE_CHARGE", client: { country: "AT", vatId: "ATU12345678", city: "Wien", postalCode: "1010" }, category: "AE", text: /Steuerschuldnerschaft des Leistungsempfängers/ },
  { name: "intra-eu", treatment: "INTRA_EU", client: { country: "FR", vatId: "FR12345678901", city: "Paris", postalCode: "75001" }, category: "K", text: /innergemeinschaftliche Lieferung/ },
  { name: "export", treatment: "EXPORT", client: { country: "CH", vatId: null, city: "Zürich", postalCode: "8001" }, category: "G", text: /Ausfuhrlieferung/ },
  { name: "exempt", treatment: "EXEMPT", invoice: { exemptionReason: "§ 4 Nr. 14 UStG (Heilbehandlung)" }, category: "E", text: /§ 4 Nr\. 14 UStG/ },
  { name: "not-taxable", treatment: "NOT_TAXABLE", client: { country: "US", vatId: null, city: "Boston", postalCode: "02108" }, invoice: { exemptionReason: "Leistungsort im Drittland (§ 3a Abs. 2 UStG)" }, category: "O", text: /Leistungsort im Drittland/ },
];

describe("e-invoices of every tax treatment", () => {
  for (const c of CASES) {
    it(`${c.name}: XML and PDF/A-3 with category ${c.category}`, async () => {
      const ctx = await company();
      const inv = await issued(ctx, { ...BUYER, ...c.client }, { taxTreatment: c.treatment, ...c.invoice });
      const { xml, pdf } = await writeAll(ctx, c.name, inv.id);
      expect(xml).toContain("urn:xeinkauf.de:kosit:xrechnung_3.0");
      expect(xml).toContain(`<cbc:ID>${c.category}</cbc:ID>`);
      if (c.text) expect(xml).toMatch(c.text);
      const doc = await PDFDocument.load(pdf, { updateMetadata: false });
      expect(doc.catalog.lookup(PDFName.of("OutputIntents"))).toBeDefined();
      expect(doc.catalog.lookup(PDFName.of("Metadata"))).toBeDefined();
      const names = doc.catalog.lookup(PDFName.of("Names"), PDFDict);
      expect(names.lookup(PDFName.of("EmbeddedFiles"), PDFDict)).toBeDefined();
    }, 60_000);
  }

  it("small business: exempt with the § 19 note and without any rate", async () => {
    const ctx = await company({ smallBusiness: true, vatId: null });
    const inv = await issued(ctx, BUYER, {});
    expect(inv.taxTreatment).toBe("SMALL_BUSINESS");
    expect(inv.vatCents).toBe(0);
    const { xml } = await writeAll(ctx, "small-business", inv.id);
    expect(xml).toContain("<cbc:ID>E</cbc:ID>");
    expect(xml).toContain("§ 19 UStG");
  }, 60_000);

  it("a cancelling credit note says which invoice it corrects, in positive amounts", async () => {
    const ctx = await company();
    const inv = await issued(ctx, BUYER, {});
    const note = await cancelInvoice(ctx, inv.id);
    const { xml } = await writeAll(ctx, "credit-note", note.id);
    expect(xml).toContain("CreditNote");
    expect(xml).toContain("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>");
    expect(xml).toContain(`<cbc:ID>${inv.number}</cbc:ID>`);
    expect(xml).toContain(`<cbc:PayableAmount currencyID="EUR">${(inv.grossCents / 100).toFixed(2)}</cbc:PayableAmount>`);
  }, 60_000);

  it("a partial credit note takes back only what it names", async () => {
    const ctx = await company();
    const inv = await issued(ctx, BUYER, { items: [line("Montage", 4, 100), line("Material", 1, 50)] });
    const { items } = await getInvoice(ctx, inv.id);
    const note = await createCreditNote(ctx, inv.id, { reason: "Eine Stunde zu viel", lines: [{ itemId: items[0].id, quantity: 1 }] });
    const { xml } = await writeAll(ctx, "partial-credit-note", note.id);
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">119.00</cbc:PayableAmount>');
  }, 60_000);

  it("leaves the validators something to refuse", async () => {
    const ctx = await company();
    const inv = await issued(ctx, BUYER, {});
    const xml = new TextDecoder().decode((await keepInvoiceFile(ctx, inv.id, "XRECHNUNG")).bytes);
    const broken = xml.replace(/<cbc:BuyerReference>.*<\/cbc:BuyerReference>/, "").replace(/<cbc:PayableAmount([^>]*)>[^<]*</, "<cbc:PayableAmount$1>1.00<");
    expect(broken).not.toBe(xml);
    keep("control-broken.ubl.xml", broken);
    keep("control-plain.zugferd.pdf", (await keepInvoiceFile(ctx, inv.id, "PDF")).bytes);
  }, 60_000);

  it("the two syntaxes say the same", async () => {
    const ctx = await company();
    const inv = await issued(ctx, BUYER, {});
    const data = await pdfData(ctx, inv.id);
    const [ubl, cii] = [await xrechnungXml(data), await xrechnungCii(data)];
    for (const xml of [ubl, cii]) expect(xml).toContain(inv.number);
    expect(cii).toContain("CrossIndustryInvoice");
    expect(cii).toContain("urn:xeinkauf.de:kosit:xrechnung_3.0");
  }, 60_000);

  it("names what is missing instead of building a file that fails", async () => {
    const ctx = await company({ phone: null, iban: null });
    const inv = await issued(ctx, { ...BUYER, email: null }, {});
    await expect(keepInvoiceFile(ctx, inv.id, "XRECHNUNG")).rejects.toMatchObject({ code: "NOT_READY", missing: ["sellerPhone", "sellerIban", "buyerEmail"] });
    await expect(keepInvoiceFile(ctx, inv.id, "ZUGFERD")).rejects.toBeInstanceOf(InvoiceFileError);
    // The plain PDF does not depend on any of it.
    expect((await keepInvoiceFile(ctx, inv.id, "PDF")).bytes.length).toBeGreaterThan(1000);
  }, 60_000);

  it("refuses a draft", async () => {
    const ctx = await company();
    const client = await createClient(ctx, BUYER);
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("x", 1, 1)] });
    await expect(keepInvoiceFile(ctx, draft.id, "XRECHNUNG")).rejects.toMatchObject({ code: "DRAFT" });
  });
});
