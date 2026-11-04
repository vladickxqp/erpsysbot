/**
 * Documents as PDF, for download and for e-mail: invoice, quote, reminder.
 * Sending goes to the address the user confirms (the client's by default),
 * with the PDF attached, and is written to the audit log.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { clients } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isLocale, MESSAGES, translator, type Locale } from "@/i18n";
import { audit } from "./audit";
import type { Context } from "./context";
import { clientParty, pdfData, sellerOf } from "./invoices";
import { emailVerified } from "./auth/email-verification";
import { companyLogo } from "./documents";
import { mailAvailable, sendMail, takeMailBudget } from "./mail";
import { registrationOpen } from "./settings";
import { invoicePdf, quotePdf, reminderPdf } from "./pdf";
import { requirePermission } from "./permissions";
import { getQuote, setQuoteStatus } from "./quotes";
import { markReminderSent, reminderData } from "./reminders";

export type DocumentKind = "invoice" | "quote" | "reminder";

export class SendError extends Error {
  constructor(public readonly code: "NO_MAIL" | "DRAFT" | "LIMIT" | "UNVERIFIED") {
    super(code);
  }
}

export type RenderedDocument = { filename: string; pdf: Uint8Array; number: string; clientEmail: string | null; total: number };

const docLocale = (ctx: Context): Locale => (isLocale(ctx.organization.locale) ? ctx.organization.locale : "de");

export async function renderInvoice(ctx: Context, id: string, locale = docLocale(ctx)): Promise<RenderedDocument & { draft: boolean }> {
  const data = await pdfData(ctx, id);
  const pdf = await invoicePdf({ ...data, locale, logo: await companyLogo(ctx) });
  const number = data.invoice.number ?? "Entwurf";
  return {
    filename: `${number}.pdf`,
    pdf,
    number,
    clientEmail: await clientEmail(ctx, data.invoice.clientId),
    total: data.invoice.grossCents - data.invoice.paidCents,
    draft: data.invoice.status === "DRAFT",
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

const sendInput = z.object({ to: z.string().trim().toLowerCase().email().max(200), message: z.string().trim().max(5000).optional() });

/** Sends one document by e-mail with the PDF attached. */
export async function sendDocument(ctx: Context, kind: DocumentKind, id: string, raw: z.input<typeof sendInput>): Promise<void> {
  requirePermission(ctx.permissions, kind === "quote" ? "orders.create" : "invoices.create");
  if (!mailAvailable()) throw new SendError("NO_MAIL");
  const input = sendInput.parse(raw);
  const doc = kind === "invoice" ? await renderInvoice(ctx, id) : kind === "quote" ? await renderQuote(ctx, id) : await renderReminder(ctx, id);
  if ("draft" in doc && doc.draft) throw new SendError("DRAFT");
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
