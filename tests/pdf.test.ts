import { describe, expect, it } from "vitest";
import { invoicePdf } from "@/server/pdf";
import type { Invoice, InvoiceItem } from "@/server/invoices";

const invoice = {
  id: "00000000-0000-0000-0000-000000000001",
  organizationId: "00000000-0000-0000-0000-000000000002",
  kind: "INVOICE",
  status: "ISSUED",
  number: "RE-2026-0001",
  clientId: "00000000-0000-0000-0000-000000000003",
  orderId: null,
  correctsId: null,
  issueDate: "2026-11-02",
  serviceDate: "2026-10-31",
  dueDate: "2026-11-16",
  notes: "Vielen Dank für Ihren Auftrag!",
  sellerSnapshot: null,
  buyerSnapshot: null,
  netCents: 23000,
  vatCents: 4370,
  grossCents: 27370,
  paidCents: 0,
  smallBusiness: false,
  issuedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies Invoice;

const item = (position: number, description: string, quantity: string, price: number): InvoiceItem => ({
  id: `00000000-0000-0000-0000-00000000001${position}`,
  organizationId: invoice.organizationId,
  invoiceId: invoice.id,
  position,
  productId: null,
  description,
  quantity,
  unit: "Std",
  unitPriceCents: price,
  discountPercent: "0",
  vatRate: 19,
  netCents: Math.round(Number(quantity) * price),
});

describe("invoice pdf", () => {
  it("renders umlauts, Cyrillic and many lines into a valid PDF", async () => {
    const items = Array.from({ length: 40 }, (_, i) => item(i + 1, `Montage Schaltschrank — Ölfeld Süd ${i + 1}`, "1", 575));
    items[0] = item(1, "Консультация (Beratung) mit einer sehr langen Beschreibung, die umbrechen muss, damit sie in die Spalte passt", "2", 9000);
    const pdf = await invoicePdf({
      invoice,
      items,
      seller: {
        name: "Müller Elektro GmbH", legalName: null, street: "Hauptstraße 1", postalCode: "68159", city: "Mannheim",
        country: "DE", vatId: "DE123456789", taxNumber: "38/123/45678", email: "info@mueller.example", phone: null,
        website: null, iban: "DE89370400440532013000", bic: "COBADEFFXXX", bankName: "Commerzbank", footer: null,
      },
      buyer: { name: "Иван Петров", street: "Weg 2", postalCode: "10115", city: "Berlin", country: "DE", vatId: null, number: 7 },
      locale: "de",
    });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
