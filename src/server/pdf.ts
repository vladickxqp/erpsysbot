/**
 * Business documents as PDF: invoice, credit note, quote, payment reminder.
 *
 * Laid out after DIN 5008 (address field for a window envelope), with what a
 * German invoice states: seller and buyer, tax number or VAT ID, number and
 * dates, every line, the net amounts and the VAT per rate, the total, how to
 * pay. A draft says DRAFT across the page and carries no number. Quotes and
 * reminders use the same head and footer.
 *
 * DejaVu Sans (assets/fonts, free licence) covers umlauts, € and Cyrillic.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Locale } from "@/i18n";
import type { Invoice, InvoiceItem, Party, Seller } from "./invoices";
import { totals } from "./money";
import { asLines } from "./orders";

const MM = 72 / 25.4;
const A4 = { width: 595.28, height: 841.89 };
const LEFT = 25 * MM;
const RIGHT = A4.width - 20 * MM;
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.89, 0.91, 0.94);
const ACCENT = rgb(0.23, 0.51, 0.96);

const LABELS = {
  de: {
    invoice: "Rechnung", creditNote: "Gutschrift", draft: "ENTWURF", number: "Rechnungsnr.", noteNumber: "Gutschriftnr.",
    date: "Datum", serviceDate: "Leistungsdatum", due: "Fällig am", client: "Kundennr.", pos: "Pos.", description: "Beschreibung",
    qty: "Menge", unitPrice: "Einzelpreis", vat: "USt.", amount: "Betrag", net: "Nettobetrag", vatOn: "USt. {rate} % auf {net}",
    total: "Gesamtbetrag", smallBusiness: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
    pay: "Bitte überweisen Sie {amount} bis zum {due} unter Angabe der Rechnungsnummer.", corrects: "Gutschrift zur Rechnung {number}.",
    taxNumber: "Steuernr.", vatId: "USt-IdNr.", page: "Seite {n} von {of}", discount: "Rabatt",
    quote: "Angebot", quoteNumber: "Angebotsnr.", validUntil: "Gültig bis", quoteValid: "Dieses Angebot gilt bis zum {date}.",
    reminder1: "Zahlungserinnerung", reminderN: "{n}. Mahnung",
    reminderIntro: "Zu der folgenden Rechnung haben wir noch keinen vollständigen Zahlungseingang festgestellt:",
    invoiceRef: "Rechnung {number} vom {date}, fällig am {due}", open: "Offener Betrag", fee: "Mahngebühr", toPay: "Zu zahlen",
    reminderPay: "Bitte überweisen Sie {amount} bis zum {due}. Falls Sie bereits gezahlt haben, betrachten Sie dieses Schreiben als gegenstandslos.",
  },
  en: {
    invoice: "Invoice", creditNote: "Credit note", draft: "DRAFT", number: "Invoice no.", noteNumber: "Credit note no.",
    date: "Date", serviceDate: "Service date", due: "Due", client: "Client no.", pos: "No.", description: "Description",
    qty: "Qty", unitPrice: "Unit price", vat: "VAT", amount: "Amount", net: "Net amount", vatOn: "VAT {rate} % on {net}",
    total: "Total", smallBusiness: "No VAT charged under § 19 UStG (small business).",
    pay: "Please transfer {amount} by {due}, quoting the invoice number.", corrects: "Credit note for invoice {number}.",
    taxNumber: "Tax no.", vatId: "VAT ID", page: "Page {n} of {of}", discount: "Discount",
    quote: "Quote", quoteNumber: "Quote no.", validUntil: "Valid until", quoteValid: "This quote is valid until {date}.",
    reminder1: "Payment reminder", reminderN: "Reminder no. {n}",
    reminderIntro: "We have not yet received full payment of the following invoice:",
    invoiceRef: "Invoice {number} of {date}, due {due}", open: "Amount open", fee: "Reminder fee", toPay: "To pay",
    reminderPay: "Please transfer {amount} by {due}. If you have already paid, please disregard this letter.",
  },
  ru: {
    invoice: "Счёт", creditNote: "Кредит-нота", draft: "ЧЕРНОВИК", number: "Счёт №", noteNumber: "Кредит-нота №",
    date: "Дата", serviceDate: "Дата услуги", due: "Оплатить до", client: "Клиент №", pos: "№", description: "Описание",
    qty: "Кол-во", unitPrice: "Цена", vat: "НДС", amount: "Сумма", net: "Сумма без НДС", vatOn: "НДС {rate} % с {net}",
    total: "Итого", smallBusiness: "Согласно § 19 UStG налог с оборота не взимается.",
    pay: "Пожалуйста, переведите {amount} до {due}, указав номер счёта.", corrects: "Кредит-нота к счёту {number}.",
    taxNumber: "Налоговый №", vatId: "USt-IdNr.", page: "Страница {n} из {of}", discount: "Скидка",
    quote: "Коммерческое предложение", quoteNumber: "Предложение №", validUntil: "Действует до", quoteValid: "Предложение действует до {date}.",
    reminder1: "Напоминание об оплате", reminderN: "{n}-е напоминание",
    reminderIntro: "По следующему счёту оплата поступила не полностью:",
    invoiceRef: "Счёт {number} от {date}, срок оплаты {due}", open: "Остаток", fee: "Сбор за напоминание", toPay: "К оплате",
    reminderPay: "Пожалуйста, переведите {amount} до {due}. Если вы уже оплатили, просто проигнорируйте это письмо.",
  },
} as const;

type Labels = Record<keyof (typeof LABELS)["de"], string>;

let fonts: Promise<[Uint8Array, Uint8Array]> | null = null;
function loadFonts() {
  const dir = path.join(process.env.ERP_ROOT ?? process.cwd(), "assets", "fonts");
  fonts ??= Promise.all([readFile(path.join(dir, "DejaVuSans.ttf")), readFile(path.join(dir, "DejaVuSans-Bold.ttf"))]);
  return fonts;
}

const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

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
  dueDate?: string | null;
  validUntil?: string | null;
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
};

export type PdfInput = {
  invoice: Invoice;
  items: InvoiceItem[];
  seller: Seller;
  buyer: Party;
  /** The number of the invoice a credit note corrects. */
  corrects?: string | null;
  locale: Locale;
};

export function invoicePdf({ invoice, items, seller, buyer, corrects, locale }: PdfInput): Promise<Uint8Array> {
  return renderDocument({
    kind: invoice.kind,
    draft: invoice.status === "DRAFT",
    number: invoice.number,
    issueDate: invoice.issueDate,
    serviceDate: invoice.serviceDate,
    dueDate: invoice.dueDate,
    items,
    netCents: invoice.netCents,
    grossCents: invoice.grossCents,
    paidCents: invoice.paidCents,
    smallBusiness: invoice.smallBusiness,
    notes: invoice.notes,
    corrects,
    seller,
    buyer,
    locale,
  });
}

export type QuotePdfInput = {
  quote: { number: string; issueDate: string; validUntil: string | null; netCents: number; grossCents: number; smallBusiness: boolean; notes: string | null; title: string | null };
  items: StoredItem[];
  seller: Seller;
  buyer: Party;
  locale: Locale;
};

export function quotePdf({ quote, items, seller, buyer, locale }: QuotePdfInput): Promise<Uint8Array> {
  return renderDocument({
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
};

export function reminderPdf({ reminder, invoice, seller, buyer, locale }: ReminderPdfInput): Promise<Uint8Array> {
  return renderDocument({
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

async function renderDocument(spec: Spec): Promise<Uint8Array> {
  const { items, seller, buyer, corrects, locale } = spec;
  const L: Labels = LABELS[locale] ?? LABELS.de;
  const tag = locale === "en" ? "en-GB" : locale;
  const money = (cents: number) => new Intl.NumberFormat(tag, { style: "currency", currency: "EUR" }).format(cents / 100);
  const date = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat(tag).format(new Date(`${iso}T12:00:00Z`)) : "—");
  const qty = (q: number) => new Intl.NumberFormat(tag, { maximumFractionDigits: 3 }).format(q);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await loadFonts();
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  const reminderTitle = spec.reminder ? (spec.reminder.level === 1 ? L.reminder1 : fill(L.reminderN, { n: String(spec.reminder.level) })) : "";
  const title = { INVOICE: L.invoice, CREDIT_NOTE: L.creditNote, QUOTE: L.quote, REMINDER: reminderTitle }[spec.kind];
  doc.setTitle(`${title} ${spec.number ?? ""}`.trim());
  doc.setAuthor(seller.name);
  doc.setCreator("AI Business OS");

  const pages: PDFPage[] = [];
  const text = (page: PDFPage, value: string, x: number, y: number, size = 9, font = regular, color = INK) =>
    page.drawText(value, { x, y, size, font, color });
  const right = (page: PDFPage, value: string, x: number, y: number, size = 9, font = regular, color = INK) =>
    page.drawText(value, { x: x - font.widthOfTextAtSize(value, size), y, size, font, color });

  const newPage = () => {
    const page = doc.addPage([A4.width, A4.height]);
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
  const top = A4.height - 20 * MM;
  text(page, seller.name, LEFT, top, 15, bold);
  const sellerLines = [
    seller.street,
    [seller.postalCode, seller.city].filter(Boolean).join(" "),
    seller.phone,
    seller.email,
    seller.website,
  ].filter(Boolean) as string[];
  sellerLines.forEach((line, i) => right(page, line, RIGHT, top - i * 11, 8.5, regular, MUTED));

  // DIN 5008 form B: address field 45 mm from the top, 20 mm from the left.
  const addressTop = A4.height - 50 * MM;
  const sender = [seller.name, seller.street, [seller.postalCode, seller.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  text(page, sender, LEFT, addressTop + 6, 6.5, regular, MUTED);
  const buyerLines = [
    ...buyer.name.split("\n"),
    buyer.street,
    [buyer.postalCode, buyer.city].filter(Boolean).join(" "),
    buyer.country && buyer.country !== "DE" ? buyer.country : null,
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
            [L.serviceDate, date(spec.serviceDate ?? spec.issueDate)],
            ...(credit ? [] : ([[L.due, date(spec.dueDate)]] as [string, string][])),
            ...client,
          ];
  meta.forEach(([label, value], i) => {
    const y = addressTop - 8 - i * 13;
    text(page, label, RIGHT - 170, y, 8.5, regular, MUTED);
    right(page, value, RIGHT, y, 9, bold);
  });

  let y = A4.height - 105 * MM;
  text(page, `${title} ${spec.number ?? ""}`.trim(), LEFT, y, 16, bold);
  y -= 16;
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
    p.drawRectangle({ x: LEFT - 4, y: at - 5, width: RIGHT - LEFT + 8, height: 18, color: rgb(0.97, 0.98, 0.99) });
    text(p, L.pos, cols.pos, at, 8, bold, MUTED);
    text(p, L.description, cols.desc, at, 8, bold, MUTED);
    right(p, L.qty, cols.qty, at, 8, bold, MUTED);
    right(p, L.unitPrice, cols.price, at, 8, bold, MUTED);
    if (!spec.smallBusiness) right(p, L.vat, cols.vat, at, 8, bold, MUTED);
    right(p, L.amount, cols.amount, at, 8, bold, MUTED);
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
      const height = (wrapped.length + discount.length) * 11 + 6;
      if (y - height < 45 * MM) {
        page = newPage();
        y = A4.height - 25 * MM;
        header(page, y);
        y -= 20;
      }
      text(page, String(item.position), cols.pos, y, 9, regular, MUTED);
      wrapped.forEach((w, i) => text(page, w, cols.desc, y - i * 11, 9));
      discount.forEach((d, i) => text(page, d, cols.desc, y - (wrapped.length + i) * 11, 8, regular, MUTED));
      right(page, `${qty(line.quantity)} ${item.unit}`, cols.qty, y, 9);
      right(page, money(item.unitPriceCents), cols.price, y, 9);
      if (!spec.smallBusiness) right(page, `${item.vatRate} %`, cols.vat, y, 9, regular, MUTED);
      right(page, money(item.netCents), cols.amount, y, 9);
      y -= height;
      page.drawLine({ start: { x: LEFT - 4, y: y + 4 }, end: { x: RIGHT + 4, y: y + 4 }, thickness: 0.5, color: LINE });
    });

    // --- Totals -----------------------------------------------------------------------------
    const sum = totals(lines, spec.smallBusiness);
    if (y < 75 * MM) {
      page = newPage();
      y = A4.height - 25 * MM;
    }
    y -= 8;
    totalRow(L.net, money(spec.netCents));
    if (!spec.smallBusiness) {
      for (const group of sum.byRate) totalRow(fill(L.vatOn, { rate: String(group.rate), net: money(group.netCents) }), money(group.vatCents));
    }
    rule();
    totalRow(L.total, money(spec.grossCents), true);
  }

  y -= 10;
  const notes: string[] = [];
  if (hasLines && spec.smallBusiness) notes.push(L.smallBusiness);
  if (spec.kind === "INVOICE" && !spec.draft) {
    notes.push(fill(L.pay, { amount: money(spec.grossCents - spec.paidCents), due: date(spec.dueDate) }));
  }
  if (spec.kind === "QUOTE" && spec.validUntil) notes.push(fill(L.quoteValid, { date: date(spec.validUntil) }));
  if (spec.notes && !credit) notes.push(spec.notes);
  for (const note of notes) {
    paragraph(note);
    y -= 4;
  }

  // --- Footer on every page -----------------------------------------------------------------
  const footer = [
    [seller.legalName || seller.name, seller.street, [seller.postalCode, seller.city].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(" · "),
    [
      seller.taxNumber ? `${L.taxNumber} ${seller.taxNumber}` : null,
      seller.vatId ? `${L.vatId} ${seller.vatId}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    [seller.bankName, seller.iban ? `IBAN ${seller.iban.replace(/(.{4})/g, "$1 ").trim()}` : null, seller.bic ? `BIC ${seller.bic}` : null]
      .filter(Boolean)
      .join(" · "),
    seller.footer ?? "",
  ].filter(Boolean);
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: LEFT, y: 22 * MM }, end: { x: RIGHT, y: 22 * MM }, thickness: 0.5, color: LINE });
    footer.forEach((line, j) => text(p, line, LEFT, 22 * MM - 10 - j * 9, 7, regular, MUTED));
    right(p, fill(L.page, { n: String(i + 1), of: String(pages.length) }), RIGHT, 22 * MM - 10, 7, regular, MUTED);
    p.drawRectangle({ x: 0, y: A4.height - 4, width: A4.width, height: 4, color: ACCENT });
  });

  return doc.save();
}
