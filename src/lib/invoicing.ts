/**
 * What forms and server share about invoices: how a sale is taxed, the words
 * that go with it, how a document looks, which state it shows. No database
 * code in here.
 *
 * Tax is never assumed. A company names its status (§ 19 UStG or not) and its
 * rates; each invoice names the kind of sale. The codes are those of EN 16931:
 * S standard, Z zero rate, E exempt, AE reverse charge, K intra-Community,
 * G export, O outside the scope of VAT. Nothing here is tax advice.
 */

export const TAX_TREATMENTS = ["STANDARD", "SMALL_BUSINESS", "REVERSE_CHARGE", "INTRA_EU", "EXPORT", "EXEMPT", "NOT_TAXABLE"] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

export const INVOICE_LAYOUTS = ["CLASSIC", "MODERN", "COMPACT"] as const;
export type InvoiceLayout = (typeof INVOICE_LAYOUTS)[number];

export const INVOICE_FILE_KINDS = ["PDF", "ZUGFERD", "XRECHNUNG"] as const;
export type InvoiceFileKind = (typeof INVOICE_FILE_KINDS)[number];

export const DEFAULT_ACCENT = "#2563eb";
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** The look of one document: frozen on an invoice when it is issued. */
export type InvoiceStyle = {
  layout: InvoiceLayout;
  accentColor: string;
  footer: string | null;
  paymentInstructions: string | null;
};

export const DEFAULT_STYLE: InvoiceStyle = { layout: "CLASSIC", accentColor: DEFAULT_ACCENT, footer: null, paymentInstructions: null };

/** A stored look, or the built-in one where something is missing or unknown. */
export function styleOf(value: unknown): InvoiceStyle {
  const v = (value ?? {}) as Partial<InvoiceStyle>;
  return {
    layout: (INVOICE_LAYOUTS as readonly string[]).includes(v.layout ?? "") ? (v.layout as InvoiceLayout) : "CLASSIC",
    accentColor: HEX_COLOR.test(v.accentColor ?? "") ? (v.accentColor as string) : DEFAULT_ACCENT,
    footer: v.footer ?? null,
    paymentInstructions: v.paymentInstructions ?? null,
  };
}

const EU = "AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK".split(" ");
export const isEu = (country: string | null | undefined) => EU.includes((country ?? "").toUpperCase());

/** What a company can choose from: a small business charges no VAT at all; the rest are German rules. */
export function availableTreatments(country: string, smallBusiness: boolean): TaxTreatment[] {
  if (smallBusiness) return ["SMALL_BUSINESS"];
  if (country !== "DE") return ["STANDARD"];
  return ["STANDARD", "REVERSE_CHARGE", "INTRA_EU", "EXPORT", "EXEMPT", "NOT_TAXABLE"];
}

/** A line of this treatment carries no tax of its own: its rate is 0. */
export const taxFree = (treatment: TaxTreatment) => treatment !== "STANDARD" && treatment !== "SMALL_BUSINESS";

export type TreatmentParties = {
  seller: { country: string | null; vatId: string | null };
  buyer: { country: string | null; vatId: string | null };
};

/** What is missing before an invoice of this kind may be issued; empty: nothing. */
export function treatmentProblems(treatment: TaxTreatment, reason: string | null | undefined, { seller, buyer }: TreatmentParties): string[] {
  const abroad = !!buyer.country && buyer.country !== (seller.country ?? "DE");
  const problems: string[] = [];
  switch (treatment) {
    case "REVERSE_CHARGE":
      // Across a border the buyer's number belongs on the invoice (§ 14a UStG); building work at home does without.
      if (abroad && !buyer.vatId) problems.push("buyerVatId");
      break;
    case "INTRA_EU":
      if (!seller.vatId) problems.push("sellerVatId");
      if (!buyer.vatId) problems.push("buyerVatId");
      if (!abroad || !isEu(buyer.country)) problems.push("buyerInEu");
      break;
    case "EXPORT":
      if (isEu(buyer.country)) problems.push("buyerOutsideEu");
      break;
    case "EXEMPT":
    case "NOT_TAXABLE":
      if (!reason?.trim()) problems.push("reason");
      break;
  }
  return problems;
}

/** The EN 16931 category of a line. */
export function taxCategory(treatment: TaxTreatment, rate: number): "S" | "Z" | "E" | "AE" | "K" | "G" | "O" {
  switch (treatment) {
    case "STANDARD":
      return rate === 0 ? "Z" : "S";
    case "SMALL_BUSINESS":
    case "EXEMPT":
      return "E";
    case "REVERSE_CHARGE":
      return "AE";
    case "INTRA_EU":
      return "K";
    case "EXPORT":
      return "G";
    case "NOT_TAXABLE":
      return "O";
  }
}

/** The EN 16931 exemption code, where the law has one. */
export const exemptionCode = (treatment: TaxTreatment): string | null =>
  ({ REVERSE_CHARGE: "VATEX-EU-AE", INTRA_EU: "VATEX-EU-IC", EXPORT: "VATEX-EU-G", NOT_TAXABLE: "VATEX-EU-O" } as Partial<Record<TaxTreatment, string>>)[treatment] ?? null;

const NOTES: Record<"de" | "en", Partial<Record<TaxTreatment, string>>> = {
  de: {
    SMALL_BUSINESS: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
    REVERSE_CHARGE: "Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG).",
    INTRA_EU: "Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1 Buchst. b, § 6a UStG).",
    EXPORT: "Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1 Buchst. a, § 6 UStG).",
    EXEMPT: "Steuerfrei: {reason}",
    NOT_TAXABLE: "Nicht im Inland steuerbar: {reason}",
  },
  en: {
    SMALL_BUSINESS: "No VAT charged under § 19 UStG (small business).",
    // The German words stay: § 14a UStG asks for them on the invoice.
    REVERSE_CHARGE: "Reverse charge: the recipient owes the VAT (Steuerschuldnerschaft des Leistungsempfängers, § 13b UStG).",
    INTRA_EU: "VAT-exempt intra-Community supply (§ 4 No. 1 b, § 6a UStG).",
    EXPORT: "VAT-exempt export delivery (§ 4 No. 1 a, § 6 UStG).",
    EXEMPT: "VAT exempt: {reason}",
    NOT_TAXABLE: "Not taxable in Germany: {reason}",
  },
};

/** The sentence an invoice of this kind must carry; null for one with VAT. */
export function taxNote(treatment: TaxTreatment, language: string, reason?: string | null): string | null {
  const text = NOTES[language === "de" ? "de" : "en"][treatment];
  return text ? text.replace("{reason}", (reason ?? "").trim()) : null;
}

export type InvoiceState = { kind: string; status: string; dueDate: string | null; sentAt?: Date | string | null };

/** Still waiting for money: the only state in which an invoice can be overdue. */
export const awaitsPayment = (i: Pick<InvoiceState, "kind" | "status">) => i.kind === "INVOICE" && ["ISSUED", "PARTIALLY_PAID"].includes(i.status);

export const isOverdue = (i: InvoiceState, today: string) => awaitsPayment(i) && !!i.dueDate && i.dueDate < today;

/** What is left to pay after payments and credit notes. */
export const openCents = (i: { grossCents: number; paidCents: number; creditedCents: number }) => i.grossCents - i.paidCents - i.creditedCents;

/** The state people see: stored as far as it is stored, "sent" and "overdue" follow from the dates. */
export function shownStatus(i: InvoiceState, today: string): string {
  if (isOverdue(i, today)) return "OVERDUE";
  return i.status === "ISSUED" && i.sentAt ? "SENT" : i.status;
}
