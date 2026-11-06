/**
 * Structured invoices: XRechnung (XML) and ZUGFeRD (PDF/A-3 with its XML inside).
 *
 * A PDF alone is no e-invoice. These two are built from the same frozen data
 * as the PDF, in the form of EN 16931, and turned into syntax by the library
 * @e-invoice-eu/core, which checks them against its schema on the way. Whether
 * a file is valid is decided by the official validators: CI runs the KoSIT
 * validator and Mustang on samples of every tax treatment (see docs/RECHNUNGEN.md).
 */
import type { Invoice as EInvoice } from "@e-invoice-eu/core";
import { countryProfile } from "@/lib/countries";
import { exemptionCode, taxCategory, taxNote } from "@/lib/invoicing";
import type { pdfData } from "./invoices";
import { lineList, totals } from "./money";
import { asLines } from "./orders";

export type InvoiceData = Awaited<ReturnType<typeof pdfData>>;

const amount = (cents: number) => (cents / 100).toFixed(2);

/** UN/ECE Rec. 20 unit codes for the units people type. */
export function unitCode(unit: string): string {
  const u = unit.trim().toLowerCase().replace(/\.$/, "");
  const map: Record<string, string> = {
    stk: "H87", stück: "H87", st: "H87", pcs: "H87", piece: "H87", шт: "H87",
    std: "HUR", h: "HUR", stunde: "HUR", stunden: "HUR", hour: "HUR", hours: "HUR", ч: "HUR",
    tag: "DAY", tage: "DAY", day: "DAY", days: "DAY",
    m: "MTR", meter: "MTR", m2: "MTK", "m²": "MTK", m3: "MTQ", "m³": "MTQ",
    kg: "KGM", g: "GRM", t: "TNE", l: "LTR", liter: "LTR",
    km: "KMT", pauschal: "LS", psch: "LS", "lump sum": "LS",
  };
  return map[u] ?? "C62";
}

const buyerEmail = ({ buyer, client }: InvoiceData) => buyer.email ?? client?.email ?? null;

/** What an e-invoice needs and this one lacks (the German rules BR-DE-* among it); empty: it can be built. */
export function einvoiceProblems(data: InvoiceData): string[] {
  const { invoice, seller, buyer } = data;
  if (!countryProfile(seller.country).xrechnung) return ["sellerCountry"];
  const problems: string[] = [];
  if (!seller.email) problems.push("sellerEmail");
  if (!/\d.*\d.*\d/.test(seller.phone ?? "")) problems.push("sellerPhone");
  if (!seller.iban) problems.push("sellerIban");
  if (!seller.vatId && !seller.taxNumber) problems.push("sellerTaxId");
  if (!buyerEmail(data)) problems.push("buyerEmail");
  for (const field of ["street", "postalCode", "city"] as const) if (!buyer[field]) problems.push(`buyer_${field}`);
  if ((invoice.taxTreatment === "REVERSE_CHARGE" || invoice.taxTreatment === "INTRA_EU") && !buyer.vatId) problems.push("buyerVatId");
  return problems;
}

const postalAddress = (p: { street: string | null; postalCode: string | null; city: string | null; country: string | null }) => ({
  "cbc:StreetName": p.street,
  "cbc:CityName": p.city,
  "cbc:PostalZone": p.postalCode,
  "cac:Country": { "cbc:IdentificationCode": p.country || "DE" },
});

/** The invoice in the library's form of EN 16931 (element names of UBL). */
export function einvoiceData(data: InvoiceData): EInvoice {
  const { invoice, items, seller, buyer, client, corrects, correctsDate } = data;
  const credit = invoice.kind === "CREDIT_NOTE";
  // A credit note states positive amounts: its type says they go the other way.
  const sign = credit ? -1 : 1;
  const currency = seller.currency ?? "EUR";
  const treatment = invoice.taxTreatment;
  const money = (name: string, cents: number) => ({ [name]: amount(cents), [`${name}@currencyID`]: currency });

  const lines = asLines(items).map((line) => ({ ...line, unitPriceCents: line.unitPriceCents * sign }));
  const sum = totals(lines, invoice.smallBusiness);
  const outsideVat = treatment === "NOT_TAXABLE";
  const reason = treatment === "STANDARD" ? null : taxNote(treatment, "de", invoice.exemptionReason);
  const code = exemptionCode(treatment);
  const taxScheme = { "cac:TaxScheme": { "cbc:ID": "VAT" } };
  const rateOf = (rate: number) => (invoice.smallBusiness ? 0 : rate);
  const category = (rate: number) => ({ "cbc:ID": taxCategory(treatment, rateOf(rate)), "cbc:Percent": String(rateOf(rate)) });

  const invoiceLines = items.map((item, index) => {
    const line = lines[index];
    const net = item.netCents * sign;
    const list = lineList(line);
    const negative = line.unitPriceCents < 0;
    // A price is never negative: a line that takes money off has a negative quantity instead.
    const quantity = negative ? -line.quantity : line.quantity;
    const discount = negative ? 0 : list - net;
    const price = negative && list !== net ? Math.abs(net / line.quantity) : Math.abs(line.unitPriceCents);
    const [name, ...rest] = item.description.split("\n");
    return {
      "cbc:ID": String(item.position),
      "cbc:InvoicedQuantity": String(quantity),
      "cbc:InvoicedQuantity@unitCode": unitCode(item.unit),
      ...money("cbc:LineExtensionAmount", net),
      ...(discount
        ? { "cac:AllowanceCharge": [{ "cbc:ChargeIndicator": "false", "cbc:AllowanceChargeReason": "Rabatt", ...money("cbc:Amount", discount) }] }
        : {}),
      "cac:Item": {
        ...(rest.length ? { "cbc:Description": rest.join("\n").slice(0, 1000) } : {}),
        "cbc:Name": name.slice(0, 200),
        // BR-O-05: outside the scope of VAT a line names no rate, while BR-DE-14 wants one in the breakdown.
        "cac:ClassifiedTaxCategory": outsideVat ? { "cbc:ID": "O", ...taxScheme } : { ...category(line.vatRate), ...taxScheme },
      },
      "cac:Price": { "cbc:PriceAmount": (price / 100).toFixed(price % 1 ? 4 : 2), "cbc:PriceAmount@currencyID": currency },
    };
  });

  const period = invoice.serviceEndDate && invoice.serviceEndDate !== invoice.serviceDate;
  const deliverTo = treatment === "INTRA_EU" ? { "cac:DeliveryLocation": { "cac:Address": postalAddress(buyer) } } : {};
  const delivery = period ? deliverTo : { "cbc:ActualDeliveryDate": invoice.serviceDate ?? invoice.issueDate, ...deliverTo };
  // An element without content is an error: a service period alone needs none.
  const hasDelivery = Object.keys(delivery).length > 0;

  const sellerTax = [
    ...(seller.vatId && !outsideVat ? [{ "cbc:CompanyID": seller.vatId, ...taxScheme }] : []),
    ...(seller.taxNumber ? [{ "cbc:CompanyID": seller.taxNumber, "cac:TaxScheme": { "cbc:ID": "FC" } }] : []),
  ];
  // BR-CO-26 wants an identifier a tax number alone does not count as.
  const sellerId = !seller.vatId || outsideVat ? (seller.taxNumber ?? seller.vatId) : null;
  const notes = [invoice.title, invoice.notes, reason].filter(Boolean);

  return {
    "ubl:Invoice": {
      "cbc:ID": invoice.number,
      "cbc:IssueDate": invoice.issueDate,
      ...(!credit && invoice.dueDate ? { "cbc:DueDate": invoice.dueDate } : {}),
      "cbc:InvoiceTypeCode": credit ? "381" : "380",
      ...(notes.length ? { "cbc:Note": notes } : {}),
      "cbc:DocumentCurrencyCode": currency,
      "cbc:BuyerReference": buyer.buyerReference || client?.buyerReference || String(buyer.number ?? invoice.number),
      ...(period ? { "cac:InvoicePeriod": { "cbc:StartDate": invoice.serviceDate, "cbc:EndDate": invoice.serviceEndDate } } : {}),
      ...(corrects
        ? { "cac:BillingReference": [{ "cac:InvoiceDocumentReference": { "cbc:ID": corrects, ...(correctsDate ? { "cbc:IssueDate": correctsDate } : {}) } }] }
        : {}),
      "cac:AccountingSupplierParty": {
        "cac:Party": {
          "cbc:EndpointID": seller.email,
          "cbc:EndpointID@schemeID": "EM",
          ...(sellerId ? { "cac:PartyIdentification": [{ "cbc:ID": sellerId }] } : {}),
          "cac:PostalAddress": postalAddress(seller),
          ...(sellerTax.length ? { "cac:PartyTaxScheme": sellerTax } : {}),
          "cac:PartyLegalEntity": { "cbc:RegistrationName": seller.legalName || seller.name },
          "cac:Contact": { "cbc:Name": seller.name, "cbc:Telephone": seller.phone, "cbc:ElectronicMail": seller.email },
        },
      },
      "cac:AccountingCustomerParty": {
        "cac:Party": {
          "cbc:EndpointID": buyerEmail(data),
          "cbc:EndpointID@schemeID": "EM",
          "cac:PostalAddress": postalAddress(buyer),
          ...(buyer.vatId && !outsideVat ? { "cac:PartyTaxScheme": { "cbc:CompanyID": buyer.vatId, ...taxScheme } } : {}),
          "cac:PartyLegalEntity": { "cbc:RegistrationName": buyer.name.split("\n")[0] },
        },
      },
      ...(hasDelivery ? { "cac:Delivery": delivery } : {}),
      "cac:PaymentMeans": [
        {
          "cbc:PaymentMeansCode": "58",
          "cbc:PaymentID": invoice.number,
          "cac:PayeeFinancialAccount": {
            "cbc:ID": seller.iban,
            "cbc:Name": seller.legalName || seller.name,
            ...(seller.bic ? { "cac:FinancialInstitutionBranch": { "cbc:ID": seller.bic } } : {}),
          },
        },
      ],
      "cac:PaymentTerms": { "cbc:Note": credit ? `Korrektur zu ${corrects ?? "Rechnung"}` : `Zahlbar bis ${invoice.dueDate}` },
      "cac:TaxTotal": [
        {
          ...money("cbc:TaxAmount", sum.vatCents),
          "cac:TaxSubtotal": sum.byRate.map((group) => ({
            ...money("cbc:TaxableAmount", group.netCents),
            ...money("cbc:TaxAmount", group.vatCents),
            "cac:TaxCategory": {
              ...category(group.rate),
              ...(code ? { "cbc:TaxExemptionReasonCode": code } : {}),
              ...(reason ? { "cbc:TaxExemptionReason": reason } : {}),
              ...taxScheme,
            },
          })),
        },
      ],
      "cac:LegalMonetaryTotal": {
        ...money("cbc:LineExtensionAmount", sum.netCents),
        ...money("cbc:TaxExclusiveAmount", sum.netCents),
        ...money("cbc:TaxInclusiveAmount", sum.grossCents),
        ...money("cbc:PayableAmount", sum.grossCents),
      },
      "cac:InvoiceLine": invoiceLines,
    },
  } as unknown as EInvoice;
}

const language = (locale: string) => (locale === "de" ? "de-de" : "en-us");

/** Warnings of the library go nowhere: the validators in CI are the judges. */
const quiet = { log: () => {}, warn: () => {}, error: (message: string) => console.error("e-invoice:", message) };

/** XRechnung in UBL syntax. */
export async function xrechnungXml(data: InvoiceData): Promise<string> {
  const { InvoiceService } = await import("@e-invoice-eu/core");
  const xml = await new InvoiceService(quiet).generate(einvoiceData(data), { format: "XRECHNUNG-UBL", lang: language(data.invoice.language), noWarnings: true });
  return typeof xml === "string" ? xml : new TextDecoder().decode(xml);
}

/** XRechnung in CII syntax: the same invoice for portals that take this one. */
export async function xrechnungCii(data: InvoiceData): Promise<string> {
  const { InvoiceService } = await import("@e-invoice-eu/core");
  const xml = await new InvoiceService(quiet).generate(einvoiceData(data), { format: "XRECHNUNG-CII", lang: language(data.invoice.language), noWarnings: true });
  return typeof xml === "string" ? xml : new TextDecoder().decode(xml);
}

/** ZUGFeRD, profile EN 16931: the invoice's PDF made PDF/A-3 with its XML inside. */
export async function zugferdPdf(data: InvoiceData, pdf: Uint8Array): Promise<Uint8Array> {
  const { InvoiceService } = await import("@e-invoice-eu/core");
  const file = await new InvoiceService(quiet).generate(einvoiceData(data), {
    format: "Factur-X-EN16931",
    lang: language(data.invoice.language),
    noWarnings: true,
    pdf: { buffer: pdf, filename: `${data.invoice.number}.pdf`, mimetype: "application/pdf" },
  });
  return typeof file === "string" ? new TextEncoder().encode(file) : file;
}
