/**
 * Business documents as PDF: invoice, credit note, quote, payment reminder.
 *
 * Laid out after DIN 5008 (address field for a window envelope), with what an
 * invoice states: seller and buyer, tax number or VAT ID, number and dates,
 * every line, the net amounts and the tax per rate, the total, how to pay. A
 * draft says DRAFT across the page and carries no number. Quotes and
 * reminders use the same head and footer.
 *
 * The seller's country decides the rest (src/lib/countries.ts): currency,
 * paper (Letter in the US), VAT or sales tax, the names of its tax numbers,
 * IBAN or account number, which note an untaxed invoice carries. An invoice
 * brings its own language and look (layout, colour, footer, payment text).
 *
 * DejaVu Sans (assets/fonts, free licence) covers umlauts, €, Cyrillic and
 * the Kazakh and Ukrainian letters.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Locale } from "@/i18n";
import { cityLine, countryProfile } from "@/lib/countries";
import { DOCUMENT_LABELS as LABELS, fill, type DocumentLabels as Labels } from "@/lib/document-labels";
import { DEFAULT_STYLE, taxFree, taxNote, type InvoiceStyle } from "@/lib/invoicing";
import type { Invoice, InvoiceItem, Party, Seller } from "./invoices";
import { discountCents, lineList, totals } from "./money";
import { asLines } from "./orders";

const MM = 72 / 25.4;
const A4 = { width: 595.28, height: 841.89 };
const LETTER = { width: 612, height: 792 };
const LEFT = 25 * MM;
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.89, 0.91, 0.94);
const ACCENT = rgb(0.23, 0.51, 0.96);
const WHITE = rgb(1, 1, 1);

/** "#2563eb" as a colour, and the ink that reads on it. */
function accentOf(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  return { color: rgb(r, g, b), ink: 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? INK : WHITE };
}



let fonts: Promise<[Uint8Array, Uint8Array]> | null = null;
function loadFonts() {
  const dir = path.join(process.env.ERP_ROOT ?? process.cwd(), "assets", "fonts");
  fonts ??= Promise.all([readFile(path.join(dir, "DejaVuSans.ttf")), readFile(path.join(dir, "DejaVuSans-Bold.ttf"))]);
  return fonts;
}


function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) current = next;
      else {
        if (current) lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

type StoredItem = Pick<
  InvoiceItem,
  "position" | "productId" | "description" | "quantity" | "unit" | "unitPriceCents" | "discountPercent" | "vatRate" | "netCents"
>;

/** What every document shares; the kind decides title, dates and closing notes. */
type Spec = {
  kind: "INVOICE" | "CREDIT_NOTE" | "QUOTE" | "REMINDER";
  draft: boolean;
  number: string | null;
  issueDate: string | null;
  serviceDate?: string | null;
  serviceEndDate?: string | null;
  dueDate?: string | null;
  validUntil?: string | null;
  /** What the invoice is about. */
  subject?: string | null;
  /** The sentence a tax-free invoice must carry. */
  taxNote?: string | null;
  style?: InvoiceStyle;
  items: StoredItem[];
  netCents: number;
  grossCents: number;
  paidCents: number;
  smallBusiness: boolean;
  notes: string | null;
  corrects?: string | null;
  reminder?: { level: number; invoiceNumber: string; invoiceDate: string | null; invoiceDue: string | null; openCents: number; feeCents: number };
  seller: Seller;
  buyer: Party;
  locale: Locale;
  logo?: Logo | null;
};

/** The company's picture in the head of a document. */
export type Logo = { bytes: Uint8Array; mime: string };

export type PdfInput = {
  invoice: Invoice;
  items: InvoiceItem[];
  seller: Seller;
  buyer: Party;
  /** The number of the invoice a credit note corrects. */
  corrects?: string | null;
  locale: Locale;
  logo?: Logo | null;
  style?: InvoiceStyle;
};

/** A document states what it stated when it was issued: payments made later are not on it. */
export function invoicePdf({ invoice, items, seller, buyer, corrects, locale, logo, style }: PdfInput): Promise<Uint8Array> {
  return renderDocument({
    kind: invoice.kind,
    draft: invoice.status === "DRAFT",
    number: invoice.number,
    issueDate: invoice.issueDate,
    serviceDate: invoice.serviceDate,
    serviceEndDate: invoice.serviceEndDate,
    dueDate: invoice.dueDate,
    subject: invoice.title,
    taxNote: taxFree(invoice.taxTreatment) ? taxNote(invoice.taxTreatment, locale, invoice.exemptionReason) : null,
    style,
    items,
    netCents: invoice.netCents,
    grossCents: invoice.grossCents,
    paidCents: 0,
    smallBusiness: invoice.smallBusiness,
    notes: invoice.notes,
    corrects,
    seller,
    buyer,
    locale,
    logo,
  });
}

export type QuotePdfInput = {
  quote: { number: string; issueDate: string; validUntil: string | null; netCents: number; grossCents: number; smallBusiness: boolean; notes: string | null; title: string | null };
  items: StoredItem[];
  seller: Seller;
  buyer: Party;
  locale: Locale;
  logo?: Logo | null;
};

export function quotePdf({ quote, items, seller, buyer, locale, logo }: QuotePdfInput): Promise<Uint8Array> {
  return renderDocument({
    logo,
    kind: "QUOTE",
    draft: false,
    number: quote.number,
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    items,
    netCents: quote.netCents,
    grossCents: quote.grossCents,
    paidCents: 0,
    smallBusiness: quote.smallBusiness,
    notes: [quote.title, quote.notes].filter(Boolean).join("\n") || null,
    seller,
    buyer,
    locale,
  });
}

export type ReminderPdfInput = {
  reminder: { level: number; issueDate: string; dueDate: string; openCents: number; feeCents: number };
  invoice: { number: string; issueDate: string | null; dueDate: string | null };
  seller: Seller;
  buyer: Party;
  locale: Locale;
  logo?: Logo | null;
};

export function reminderPdf({ reminder, invoice, seller, buyer, locale, logo }: ReminderPdfInput): Promise<Uint8Array> {
  return renderDocument({
    logo,
    kind: "REMINDER",
    draft: false,
    number: null,
    issueDate: reminder.issueDate,
    dueDate: reminder.dueDate,
    items: [],
    netCents: 0,
    grossCents: reminder.openCents + reminder.feeCents,
    paidCents: 0,
    smallBusiness: true,
    notes: null,
    reminder: {
      level: reminder.level,
      invoiceNumber: invoice.number,
      invoiceDate: invoice.issueDate,
      invoiceDue: invoice.dueDate,
      openCents: reminder.openCents,
      feeCents: reminder.feeCents,
    },
    seller,
    buyer,
    locale,
  });
}

/** A report as a landscape table (A4, Letter in the US): title, period, header row, rows, totals; repeated header on each page. */
export async function tablePdf(input: {
  company: string;
  paper?: "A4" | "LETTER";
  title: string;
  subtitle: string;
  columns: { label: string; align: "left" | "right" }[];
  rows: string[][];
  totals?: string[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await loadFonts();
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  doc.setTitle(input.title);
  doc.setAuthor(input.company);
  doc.setCreator("NEXORA ONE");
  const sheet = input.paper === "LETTER" ? LETTER : A4;
  const W = sheet.height;
  const H = sheet.width;
  const left = 15 * MM;
  const right = W - 15 * MM;
  const width = (right - left) / input.columns.length;
  const fit = (text: string, font: PDFFont, size: number) => {
    let out = text;
    while (out.length > 1 && font.widthOfTextAtSize(out, size) > width - 6) out = out.slice(0, -2) + "…";
    return out;
  };
  const pages: PDFPage[] = [];
  let page: PDFPage;
  let y = 0;
  const row = (cells: string[], font: PDFFont, shade = false) => {
    if (shade) page.drawRectangle({ x: left - 3, y: y - 4, width: right - left + 6, height: 15, color: rgb(0.97, 0.98, 0.99) });
    cells.forEach((cell, i) => {
      const text = fit(cell, font, 8.5);
      const x = input.columns[i].align === "right" ? left + (i + 1) * width - 4 - font.widthOfTextAtSize(text, 8.5) : left + i * width + 2;
      page.drawText(text, { x, y, size: 8.5, font, color: INK });
    });
    y -= 15;
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: H - 4, width: W, height: 4, color: ACCENT });
    y = H - 15 * MM;
    if (pages.length === 1) {
      page.drawText(input.title, { x: left, y, size: 15, font: bold, color: INK });
      y -= 14;
      page.drawText(`${input.company} · ${input.subtitle}`, { x: left, y, size: 9, font: regular, color: MUTED });
      y -= 22;
    }
    row(input.columns.map((c) => c.label), bold, true);
  };
  newPage();
  for (const cells of input.rows) {
    if (y < 18 * MM) newPage();
    row(cells, regular);
    page!.drawLine({ start: { x: left - 3, y: y + 11 }, end: { x: right + 3, y: y + 11 }, thickness: 0.4, color: LINE });
  }
  if (input.totals) {
    if (y < 18 * MM) newPage();
    y -= 2;
    row(input.totals, bold, true);
  }
  pages.forEach((p, i) => {
    const label = `${i + 1} / ${pages.length}`;
    p.drawText(label, { x: right - regular.widthOfTextAtSize(label, 7), y: 8 * MM, size: 7, font: regular, color: MUTED });
  });
  return doc.save();
}

async function renderDocument(spec: Spec): Promise<Uint8Array> {
  const { items, seller, buyer, corrects, locale } = spec;
  const L: Labels = LABELS[locale] ?? LABELS.de;
  const country = countryProfile(seller.country);
  const sheet = country.paper === "LETTER" ? LETTER : A4;
  const RIGHT = sheet.width - 20 * MM;
  const salesTax = country.taxKind === "SALES_TAX";
  const tag = `${locale}-${country.code}`;
  // Issued before currencies existed: euro.
  const currency = seller.currency ?? "EUR";
  // A currency sign the font lacks (₾, ₼ …) is written as its code instead.
  const money = (cents: number) => {
    const written = new Intl.NumberFormat(tag, { style: "currency", currency }).format(cents / 100);
    if ([...written].every((ch) => glyphs.has(ch.codePointAt(0)!))) return written;
    return new Intl.NumberFormat(tag, { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);
  };
  const date = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat(tag).format(new Date(`${iso}T12:00:00Z`)) : "—");
  const qty = (q: number) => new Intl.NumberFormat(tag, { maximumFractionDigits: 3 }).format(q);
  const style = spec.style ?? DEFAULT_STYLE;
  const modern = style.layout === "MODERN";
  const compact = style.layout === "COMPACT";
  const accent = accentOf(style.accentColor);
  const titleColor = modern ? accent.color : INK;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await loadFonts();
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  const glyphs = new Set(regular.getCharacterSet());
  const reminderTitle = spec.reminder ? (spec.reminder.level === 1 ? L.reminder1 : fill(L.reminderN, { n: String(spec.reminder.level) })) : "";
  const title = { INVOICE: L.invoice, CREDIT_NOTE: L.creditNote, QUOTE: L.quote, REMINDER: reminderTitle }[spec.kind];
  doc.setTitle(`${title} ${spec.number ?? ""}`.trim());
  doc.setAuthor(seller.name);
  doc.setCreator("NEXORA ONE");

  const pages: PDFPage[] = [];
  // A sign the font lacks would print as an empty box, and PDF/A forbids it.
  const printable = (value: string) => [...value.replace(/\s/g, " ")].map((ch) => (glyphs.has(ch.codePointAt(0)!) ? ch : "?")).join("");
  const text = (page: PDFPage, value: string, x: number, y: number, size = 9, font = regular, color = INK) =>
    page.drawText(printable(value), { x, y, size, font, color });
  const right = (page: PDFPage, value: string, x: number, y: number, size = 9, font = regular, color = INK) => {
    const shown = printable(value);
    page.drawText(shown, { x: x - font.widthOfTextAtSize(shown, size), y, size, font, color });
  };

  const newPage = () => {
    const page = doc.addPage([sheet.width, sheet.height]);
    pages.push(page);
    if (spec.draft) {
      page.drawText(L.draft, {
        x: 140, y: 300, size: 90, font: bold, color: rgb(0.86, 0.15, 0.15), opacity: 0.08, rotate: degrees(35),
      });
    }
    return page;
  };

  // --- Head ---------------------------------------------------------------------------------
  let page = newPage();
  const top = sheet.height - 20 * MM;
  const headInk = modern ? accent.ink : MUTED;
  if (modern) page.drawRectangle({ x: 0, y: sheet.height - 42 * MM, width: sheet.width, height: 42 * MM, color: accent.color });
  const picture = spec.logo ? await (spec.logo.mime === "image/png" ? doc.embedPng(spec.logo.bytes) : doc.embedJpg(spec.logo.bytes)).catch(() => null) : null;
  if (picture) {
    const size = picture.scaleToFit(55 * MM, 16 * MM);
    // A logo is drawn for white paper: on the band it gets a white ground.
    if (modern) page.drawRectangle({ x: LEFT - 6, y: top + 6 - size.height, width: size.width + 12, height: size.height + 12, color: WHITE });
    page.drawImage(picture, { x: LEFT, y: top + 12 - size.height, width: size.width, height: size.height });
  } else text(page, seller.name, LEFT, top, compact ? 12 : 15, bold, modern ? accent.ink : INK);
  const sellerLines = [
    seller.street,
    cityLine(seller),
    seller.phone,
    seller.email,
    seller.website,
  ].filter(Boolean) as string[];
  sellerLines.forEach((line, i) => right(page, line, RIGHT, top - i * 11, 8.5, regular, headInk));

  // DIN 5008 form B: address field 45 mm from the top, 20 mm from the left.
  const addressTop = sheet.height - 50 * MM;
  const sender = [seller.name, seller.street, cityLine(seller)].filter(Boolean).join(" · ");
  text(page, sender, LEFT, addressTop + 6, 6.5, regular, MUTED);
  const buyerLines = [
    ...buyer.name.split("\n"),
    buyer.street,
    cityLine(buyer),
    buyer.country && buyer.country !== country.code ? (new Intl.DisplayNames([locale], { type: "region" }).of(buyer.country) ?? buyer.country) : null,
  ].filter(Boolean) as string[];
  buyerLines.forEach((line, i) => text(page, line, LEFT, addressTop - 8 - i * 12, 10));

  // Meta block on the right.
  const credit = spec.kind === "CREDIT_NOTE";
  const client: [string, string][] = buyer.number ? [[L.client, String(buyer.number)]] : [];
  const meta: [string, string][] =
    spec.kind === "QUOTE"
      ? [[L.quoteNumber, spec.number ?? "—"], [L.date, date(spec.issueDate)], [L.validUntil, date(spec.validUntil)], ...client]
      : spec.kind === "REMINDER"
        ? [[L.date, date(spec.issueDate)], [L.due, date(spec.dueDate)], ...client]
        : [
            [credit ? L.noteNumber : L.number, spec.number ?? "—"],
            [L.date, date(spec.issueDate)],
            spec.serviceEndDate && spec.serviceEndDate !== spec.serviceDate
              ? [L.servicePeriod, `${date(spec.serviceDate)} – ${date(spec.serviceEndDate)}`]
              : [L.serviceDate, date(spec.serviceDate ?? spec.issueDate)],
            ...(credit ? [] : ([[L.due, date(spec.dueDate)]] as [string, string][])),
            ...client,
          ];
  meta.forEach(([label, value], i) => {
    const y = addressTop - 8 - i * 13;
    text(page, label, RIGHT - 215, y, 8.5, regular, MUTED);
    right(page, value, RIGHT, y, 9, bold);
  });

  let y = sheet.height - 105 * MM;
  text(page, `${title} ${spec.number ?? ""}`.trim(), LEFT, y, compact ? 13 : 16, bold, titleColor);
  y -= compact ? 14 : 16;
  if (spec.subject) {
    text(page, spec.subject, LEFT, y, 10, bold);
    y -= 14;
  }
  if (credit && corrects) {
    text(page, fill(L.corrects, { number: corrects }), LEFT, y, 9, regular, MUTED);
    y -= 14;
  }

  const totalRow = (label: string, value: string, strong = false) => {
    text(page, label, RIGHT - 220, y, strong ? 10.5 : 9, strong ? bold : regular, strong ? INK : MUTED);
    right(page, value, RIGHT, y, strong ? 10.5 : 9, strong ? bold : regular);
    y -= strong ? 18 : 13;
  };
  const rule = () => {
    page.drawLine({ start: { x: RIGHT - 220, y: y + 9 }, end: { x: RIGHT, y: y + 9 }, thickness: 0.8, color: INK });
    y -= 2;
  };
  const paragraph = (value: string, size = 9) => {
    for (const w of wrap(value, regular, size, RIGHT - LEFT)) {
      if (y < 30 * MM) {
        page = newPage();
        y = sheet.height - 25 * MM;
      }
      text(page, w, LEFT, y, size);
      y -= size + 3;
    }
  };

  // --- Reminder: the invoice and what is owed, instead of lines -----------------------------
  if (spec.reminder) {
    const r = spec.reminder;
    y -= 6;
    paragraph(L.reminderIntro, 9.5);
    y -= 6;
    text(page, fill(L.invoiceRef, { number: r.invoiceNumber, date: date(r.invoiceDate), due: date(r.invoiceDue) }), LEFT, y, 9.5, bold);
    y -= 22;
    totalRow(L.open, money(r.openCents));
    if (r.feeCents) totalRow(L.fee, money(r.feeCents));
    rule();
    totalRow(L.toPay, money(r.openCents + r.feeCents), true);
    y -= 10;
    paragraph(fill(L.reminderPay, { amount: money(r.openCents + r.feeCents), due: date(spec.dueDate) }));
  }

  // --- Lines --------------------------------------------------------------------------------
  const cols = { pos: LEFT, desc: LEFT + 28, qty: RIGHT - 215, price: RIGHT - 120, vat: RIGHT - 70, amount: RIGHT };
  const header = (p: PDFPage, at: number) => {
    const ink = modern ? accent.ink : MUTED;
    if (compact) p.drawLine({ start: { x: LEFT - 4, y: at - 5 }, end: { x: RIGHT + 4, y: at - 5 }, thickness: 0.8, color: INK });
    else p.drawRectangle({ x: LEFT - 4, y: at - 5, width: RIGHT - LEFT + 8, height: 18, color: modern ? accent.color : rgb(0.97, 0.98, 0.99) });
    text(p, L.pos, cols.pos, at, 8, bold, ink);
    text(p, L.description, cols.desc, at, 8, bold, ink);
    right(p, L.qty, cols.qty, at, 8, bold, ink);
    right(p, L.unitPrice, cols.price, at, 8, bold, ink);
    if (!spec.smallBusiness) right(p, salesTax ? L.tax : L.vat, cols.vat, at, 8, bold, ink);
    right(p, L.amount, cols.amount, at, 8, bold, ink);
  };
  const hasLines = items.length > 0;
  const lines = asLines(items);
  if (hasLines) {
    y -= 14;
    header(page, y);
    y -= 20;
    const descWidth = cols.qty - cols.desc - 60;
    items.forEach((item, index) => {
      const line = lines[index];
      const wrapped = wrap(item.description, regular, 9, descWidth);
      const discount = line.discountPercent ? [`${L.discount} ${qty(line.discountPercent)} %`] : [];
      const height = (wrapped.length + discount.length) * 11 + (compact ? 3 : 6);
      if (y - height < 45 * MM) {
        page = newPage();
        y = sheet.height - 25 * MM;
        header(page, y);
        y -= 20;
      }
      text(page, String(item.position), cols.pos, y, 9, regular, MUTED);
      wrapped.forEach((w, i) => text(page, w, cols.desc, y - i * 11, 9));
      discount.forEach((d, i) => text(page, d, cols.desc, y - (wrapped.length + i) * 11, 8, regular, MUTED));
      right(page, `${qty(line.quantity)} ${item.unit}`, cols.qty, y, 9);
      right(page, money(item.unitPriceCents), cols.price, y, 9);
      if (!spec.smallBusiness) right(page, `${qty(Number(item.vatRate))} %`, cols.vat, y, 9, regular, MUTED);
      right(page, money(item.netCents), cols.amount, y, 9);
      y -= height;
      // Halfway between this line's text and the next one's.
      page.drawLine({ start: { x: LEFT - 4, y: y + 10 }, end: { x: RIGHT + 4, y: y + 10 }, thickness: 0.5, color: LINE });
    });

    // --- Totals -----------------------------------------------------------------------------
    const sum = totals(lines, spec.smallBusiness);
    if (y < 75 * MM) {
      page = newPage();
      y = sheet.height - 25 * MM;
    }
    y -= 8;
    const discounts = discountCents(lines);
    if (discounts) {
      totalRow(L.listTotal, money(lines.reduce((all, line) => all + lineList(line), 0)));
      totalRow(L.discounts, money(-discounts));
    }
    totalRow(salesTax ? L.subtotal : L.net, money(spec.netCents));
    if (!spec.smallBusiness) {
      for (const group of sum.byRate) {
        totalRow(fill(salesTax ? L.salesTaxOn : L.vatOn, { rate: qty(group.rate), net: money(group.netCents) }), money(group.vatCents));
      }
    }
    rule();
    totalRow(L.total, money(spec.grossCents), true);
  }

  y -= 10;
  const notes: string[] = [];
  if (hasLines && spec.smallBusiness) {
    notes.push(country.smallBusiness === "DE" ? L.smallBusiness : country.smallBusiness === "AT" ? L.smallBusinessAT : L.noVat);
  }
  if (spec.taxNote) notes.push(spec.taxNote);
  if (spec.kind === "INVOICE" && !spec.draft) {
    const owed = { amount: money(spec.grossCents - spec.paidCents), due: date(spec.dueDate), number: spec.number ?? "" };
    notes.push(fill(style.paymentInstructions ?? L.pay, owed));
    if (seller.iban && country.iban) {
      notes.push(
        [`${L.bankDetails}: ${seller.legalName || seller.name}`, seller.bankName, `IBAN ${seller.iban.replace(/(.{4})/g, "$1 ").trim()}`, seller.bic ? `BIC ${seller.bic}` : null]
          .filter(Boolean)
          .join(" · "),
      );
    }
  }
  if (spec.kind === "QUOTE" && spec.validUntil) notes.push(fill(L.quoteValid, { date: date(spec.validUntil) }));
  // Credit notes made before they had a reason carry the invoice's number here.
  if (spec.notes && credit && spec.notes !== corrects) notes.push(`${L.reason}: ${spec.notes}`);
  if (spec.notes && !credit) notes.push(spec.notes);
  for (const note of notes) {
    paragraph(note);
    y -= 4;
  }

  // --- Footer on every page -----------------------------------------------------------------
  const footer = [
    [seller.legalName || seller.name, seller.street, cityLine(seller)]
      .filter(Boolean)
      .join(" · "),
    [
      seller.taxNumber ? `${country.taxNumberLabel ?? L.taxNumber} ${seller.taxNumber}` : null,
      seller.vatId ? `${country.vatIdLabel ?? L.vatId} ${seller.vatId}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    (country.iban
      ? [seller.bankName, seller.iban ? `IBAN ${seller.iban.replace(/(.{4})/g, "$1 ").trim()}` : null, seller.bic ? `BIC ${seller.bic}` : null]
      : [seller.bankName, seller.iban ? `${L.account} ${seller.iban}` : null, seller.bic ? `${country.bankCodeLabel ?? L.bankCode} ${seller.bic}` : null]
    )
      .filter(Boolean)
      .join(" · "),
    style.footer ?? seller.footer ?? "",
  ].filter(Boolean);
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: LEFT, y: 22 * MM }, end: { x: RIGHT, y: 22 * MM }, thickness: 0.5, color: LINE });
    footer.forEach((line, j) => text(p, line, LEFT, 22 * MM - 10 - j * 9, 7, regular, MUTED));
    right(p, fill(L.page, { n: String(i + 1), of: String(pages.length) }), RIGHT, 22 * MM - 10, 7, regular, MUTED);
    if (!compact && !(modern && i === 0)) p.drawRectangle({ x: 0, y: sheet.height - 4, width: sheet.width, height: 4, color: accent.color });
  });

  return doc.save();
}
