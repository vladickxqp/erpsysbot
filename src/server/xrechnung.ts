/**
 * An issued invoice as XRechnung (UBL 2.1 Invoice, CIUS XRechnung 3.0).
 *
 * Built from the frozen seller/buyer snapshots and the stored lines, like the
 * PDF. This is the machine-readable twin of the PDF; whether a given
 * recipient's portal accepts it is checked by that portal's validator — the
 * app does not claim certified compliance.
 */
import type { Context } from "./context";
import { pdfData } from "./invoices";
import { totals } from "./money";
import { asLines } from "./orders";
import { getClient } from "./clients";

export class XRechnungError extends Error {
  constructor(public readonly code: "DRAFT" | "CREDIT_NOTE" | "NOT_GERMAN") {
    super(code);
  }
}

const esc = (value: string | number | null | undefined) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const amount = (cents: number) => (cents / 100).toFixed(2);

/** UN/ECE Rec. 20 unit codes for the units people type. */
function unitCode(unit: string): string {
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

export async function xrechnungXml(ctx: Context, invoiceId: string): Promise<{ xml: string; number: string }> {
  const { invoice, items, seller, buyer } = await pdfData(ctx, invoiceId);
  if (invoice.status === "DRAFT" || !invoice.number) throw new XRechnungError("DRAFT");
  if (invoice.kind !== "INVOICE") throw new XRechnungError("CREDIT_NOTE");
  // The German e-invoice standard: for sellers in Germany only.
  if ((seller.country ?? "DE") !== "DE") throw new XRechnungError("NOT_GERMAN");
  const cur = seller.currency ?? "EUR";
  const client = await getClient(ctx, invoice.clientId).catch(() => null);
  const lines = asLines(items);
  const sum = totals(lines, invoice.smallBusiness);
  const category = (rate: number) => (invoice.smallBusiness ? "E" : rate === 0 ? "Z" : "S");
  const taxScheme = "<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>";
  const exemption = invoice.smallBusiness ? "<cbc:TaxExemptionReason>Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG</cbc:TaxExemptionReason>" : "";

  const party = (p: { name: string; street: string | null; postalCode: string | null; city: string | null; country: string | null }, endpoint: string | null) => `
      ${endpoint ? `<cbc:EndpointID schemeID="EM">${esc(endpoint)}</cbc:EndpointID>` : ""}
      <cac:PostalAddress>
        <cbc:StreetName>${esc(p.street)}</cbc:StreetName>
        <cbc:CityName>${esc(p.city)}</cbc:CityName>
        <cbc:PostalZone>${esc(p.postalCode)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${esc(p.country || "DE")}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>`;

  const sellerTax = [
    seller.vatId ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(seller.vatId)}</cbc:CompanyID>${taxScheme}</cac:PartyTaxScheme>` : "",
    seller.taxNumber ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(seller.taxNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>FC</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : "",
  ].join("");

  const lineXml = items
    .map((item, i) => {
      const quantity = lines[i].quantity;
      const unitPrice = quantity ? item.netCents / 100 / quantity : 0;
      return `
  <cac:InvoiceLine>
    <cbc:ID>${item.position}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${unitCode(item.unit)}">${quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${cur}">${amount(item.netCents)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(item.description.split("\n")[0].slice(0, 200))}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${category(item.vatRate)}</cbc:ID>
        <cbc:Percent>${invoice.smallBusiness ? 0 : item.vatRate}</cbc:Percent>
        ${taxScheme}
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${cur}">${unitPrice.toFixed(4).replace(/0{1,2}$/, "")}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;
    })
    .join("");

  const groups = invoice.smallBusiness ? [{ rate: 0, netCents: sum.netCents, vatCents: 0 }] : sum.byRate;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(invoice.number)}</cbc:ID>
  <cbc:IssueDate>${invoice.issueDate}</cbc:IssueDate>
  ${invoice.dueDate ? `<cbc:DueDate>${invoice.dueDate}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  ${invoice.notes ? `<cbc:Note>${esc(invoice.notes)}</cbc:Note>` : ""}
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${esc(client?.buyerReference || invoice.number)}</cbc:BuyerReference>
  ${invoice.serviceDate ? `<cac:InvoicePeriod><cbc:StartDate>${invoice.serviceDate}</cbc:StartDate><cbc:EndDate>${invoice.serviceDate}</cbc:EndDate></cac:InvoicePeriod>` : ""}
  <cac:AccountingSupplierParty>
    <cac:Party>${party(seller, seller.email)}
      ${sellerTax}
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(seller.legalName || seller.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:Name>${esc(seller.name)}</cbc:Name>
        <cbc:Telephone>${esc(seller.phone || "-")}</cbc:Telephone>
        <cbc:ElectronicMail>${esc(seller.email || "-")}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>${party(buyer, client?.email ?? null)}
      ${buyer.vatId ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(buyer.vatId)}</cbc:CompanyID>${taxScheme}</cac:PartyTaxScheme>` : ""}
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(buyer.name.split("\n")[0])}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  ${
    seller.iban
      ? `<cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cbc:PaymentID>${esc(invoice.number)}</cbc:PaymentID>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(seller.iban)}</cbc:ID>
      <cbc:Name>${esc(seller.legalName || seller.name)}</cbc:Name>
      ${seller.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${esc(seller.bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ""}
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`
      : ""
  }
  ${invoice.dueDate ? `<cac:PaymentTerms><cbc:Note>Zahlbar bis ${invoice.dueDate}</cbc:Note></cac:PaymentTerms>` : ""}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${cur}">${amount(invoice.vatCents)}</cbc:TaxAmount>${groups
      .map(
        (g) => `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${cur}">${amount(g.netCents)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${cur}">${amount(g.vatCents)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${category(g.rate)}</cbc:ID>
        <cbc:Percent>${g.rate}</cbc:Percent>
        ${exemption}
        ${taxScheme}
      </cac:TaxCategory>
    </cac:TaxSubtotal>`,
      )
      .join("")}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${cur}">${amount(invoice.netCents)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${amount(invoice.netCents)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${amount(invoice.grossCents)}</cbc:TaxInclusiveAmount>
    <cbc:PrepaidAmount currencyID="${cur}">${amount(invoice.paidCents)}</cbc:PrepaidAmount>
    <cbc:PayableAmount currencyID="${cur}">${amount(invoice.grossCents - invoice.paidCents)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lineXml}
</ubl:Invoice>
`;
  return { xml: xml.replace(/\n\s*\n/g, "\n"), number: invoice.number };
}
