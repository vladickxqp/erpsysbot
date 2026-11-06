/**
 * Documents as PDF, for download and for e-mail: invoice, quote, reminder.
 * Sending goes to the address the user confirms (the client's by default),
 * with the PDF attached, and is written to the audit log.
 *
 * An invoice goes out as the file kept for it, in the format chosen. Every
 * attempt lands in its delivery history; only one the mail server took marks
 * it as sent.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { clients, invoiceDeliveries, invoices } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isLocale, MESSAGES, translator, type Locale } from "@/i18n";
import { INVOICE_FILE_KINDS, type InvoiceFileKind } from "@/lib/invoicing";
import { audit } from "./audit";
import type { Context } from "./context";
import { clientParty, pdfData, sellerOf } from "./invoices";
import { emailVerified } from "./auth/email-verification";
import { companyLogo } from "./documents";
import { keepInvoiceFile, renderPdf, type StoredFile } from "./invoice-files";
import { deliverMail, mailAvailable, sendMail, takeMailBudget } from "./mail";
import { registrationOpen } from "./settings";
import { quotePdf, reminderPdf } from "./pdf";
import { requirePermission } from "./permissions";
import { getQuote, setQuoteStatus } from "./quotes";
import { markReminderSent, reminderData } from "./reminders";

export type DocumentKind = "invoice" | "quote" | "reminder";

export class SendError extends Error {
  constructor(public readonly code: "NO_MAIL" | "DRAFT" | "LIMIT" | "UNVERIFIED" | "REFUSED") {
    super(code);
  }
}

export type RenderedDocument = { filename: string; pdf: Uint8Array; number: string; clientEmail: string | null; total: number };

const docLocale = (ctx: Context): Locale => (isLocale(ctx.organization.locale) ? ctx.organization.locale : "de");

/** The invoice as the customer has it: the kept file once issued, a fresh picture of a draft. */
export async function renderInvoice(ctx: Context, id: string): Promise<RenderedDocument & { draft: boolean }> {
  const data = await pdfData(ctx, id);
  const draft = data.invoice.status === "DRAFT";
  const pdf = draft ? await renderPdf(ctx, data) : (await keepInvoiceFile(ctx, id, "PDF")).bytes;
  const number = data.invoice.number ?? "Entwurf";
  return {
    filename: `${number.replace(/[^\w.-]+/g, "_")}.pdf`,
    pdf,
    number,
    clientEmail: await clientEmail(ctx, data.invoice.clientId),
    total: data.invoice.grossCents - data.invoice.paidCents - data.invoice.creditedCents,
    draft,
  };
}

export async function renderQuote(ctx: Context, id: string, locale = docLocale(ctx)): Promise<RenderedDocument> {
  const { quote, items, client } = await getQuote(ctx, id);
  const buyer = await withTenant(ctx.organization.id, (tx) => clientParty(tx, quote.clientId));
  const pdf = await quotePdf({ quote, items, seller: sellerOf(ctx.organization), buyer, locale, logo: await companyLogo(ctx) });
  return { filename: `${quote.number}.pdf`, pdf, number: quote.number, clientEmail: client?.email ?? null, total: quote.grossCents };
}

export async function renderReminder(ctx: Context, id: string, locale = docLocale(ctx)): Promise<RenderedDocument> {
  const { reminder, invoice, buyer, seller } = await reminderData(ctx, id);
  const pdf = await reminderPdf({ reminder, invoice: { number: invoice.number!, issueDate: invoice.issueDate, dueDate: invoice.dueDate }, seller, buyer, locale, logo: await companyLogo(ctx) });
  const number = `${invoice.number}-M${reminder.level}`;
  return { filename: `${number}.pdf`, pdf, number, clientEmail: await clientEmail(ctx, invoice.clientId), total: reminder.openCents + reminder.feeCents };
}

async function clientEmail(ctx: Context, clientId: string): Promise<string | null> {
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.select({ email: clients.email }).from(clients).where(eq(clients.id, clientId)).limit(1);
    return row?.email ?? null;
  });
}

const sendInput = z.object({
  to: z.string().trim().toLowerCase().email().max(200),
  message: z.string().trim().max(5000).optional(),
  /** Invoices only; left out: the company's choice. */
  format: z.enum(INVOICE_FILE_KINDS).optional(),
});

/** Sends one document by e-mail with the PDF attached. */
export async function sendDocument(ctx: Context, kind: DocumentKind, id: string, raw: z.input<typeof sendInput>): Promise<void> {
  if (kind === "invoice") return sendInvoice(ctx, id, raw);
  requirePermission(ctx.permissions, kind === "quote" ? "orders.create" : "invoices.create");
  if (!mailAvailable()) throw new SendError("NO_MAIL");
  const input = sendInput.parse(raw);
  const doc = kind === "quote" ? await renderQuote(ctx, id) : await renderReminder(ctx, id);
  if (registrationOpen() && !(await emailVerified(ctx.user.userId))) throw new SendError("UNVERIFIED");
  if (!takeMailBudget(ctx.organization.id)) throw new SendError("LIMIT");
  const t = translator(MESSAGES[docLocale(ctx)]);
  const org = ctx.organization;
  await sendMail({
    to: input.to,
    subject: t(`mail.${kind}Subject`, { number: doc.number, company: org.name }),
    text: input.message || t(`mail.${kind}Text`, { number: doc.number, company: org.name }),
    attachments: [{ filename: doc.filename, content: doc.pdf, contentType: "application/pdf" }],
  });
  if (kind === "reminder") await markReminderSent(ctx, id);
  if (kind === "quote") {
    const { quote } = await getQuote(ctx, id);
    if (quote.status === "DRAFT") await setQuoteStatus(ctx, id, "SENT");
  }
  await withTenant(org.id, (tx) => audit(tx, ctx, `${kind}.send`, kind, id, { to: input.to, number: doc.number }));
}

/** What travels with the mail: an e-invoice in XML comes with its readable PDF. */
async function invoiceAttachments(ctx: Context, id: string, format: InvoiceFileKind): Promise<StoredFile[]> {
  const main = await keepInvoiceFile(ctx, id, format);
  return format === "XRECHNUNG" ? [main, await keepInvoiceFile(ctx, id, "PDF")] : [main];
}

/** Why a mail failed, for the history: short, nothing but what the server said. */
const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 300);

/**
 * Sends an invoice with its file. The mail server's refusal is written to the
 * history and leaves the invoice as it was; only a mail it took sets the date.
 */
export async function sendInvoice(ctx: Context, id: string, raw: z.input<typeof sendInput>): Promise<void> {
  requirePermission(ctx.permissions, "invoices.create");
  if (!mailAvailable()) throw new SendError("NO_MAIL");
  const input = sendInput.parse(raw);
  const { invoice } = await pdfData(ctx, id);
  if (invoice.status === "DRAFT" || !invoice.number) throw new SendError("DRAFT");
  const org = ctx.organization;
  const format = input.format ?? (org.einvoiceFormat as InvoiceFileKind);
  const files = await invoiceAttachments(ctx, id, format);
  if (registrationOpen() && !(await emailVerified(ctx.user.userId))) throw new SendError("UNVERIFIED");
  if (!takeMailBudget(org.id)) throw new SendError("LIMIT");

  const language = isLocale(invoice.language) ? invoice.language : docLocale(ctx);
  const t = translator(MESSAGES[language]);
  const words = invoice.kind === "CREDIT_NOTE" ? "invoicing.mail_creditNote" : "mail.invoice";
  const subject = t(`${words}Subject`, { number: invoice.number, company: org.name });
  const delivery = { organizationId: org.id, invoiceId: id, format, recipient: input.to, subject, sentBy: ctx.user.userId };
  let messageId: string | null;
  try {
    ({ messageId } = await deliverMail({
      to: input.to,
      replyTo: org.email ?? undefined,
      subject,
      text: input.message || t(`${words}Text`, { number: invoice.number, company: org.name }),
      attachments: files.map((file) => ({ filename: file.name, content: file.bytes, contentType: file.mimeType })),
    }));
  } catch (e) {
    const error = reasonOf(e);
    await withTenant(org.id, async (tx) => {
      await tx.insert(invoiceDeliveries).values({ ...delivery, status: "FAILED", error });
      await audit(tx, ctx, "invoice.send_failed", "invoice", id, { to: input.to, number: invoice.number, format });
    });
    console.error("mail: invoice not sent", id, error);
    throw new SendError("REFUSED");
  }
  await withTenant(org.id, async (tx) => {
    await tx.insert(invoiceDeliveries).values({ ...delivery, status: "SENT", messageId });
    const now = new Date();
    await tx.update(invoices).set({ sentAt: invoice.sentAt ?? now, updatedAt: now }).where(eq(invoices.id, id));
    await audit(tx, ctx, "invoice.send", "invoice", id, { to: input.to, number: invoice.number, format });
  });
}
