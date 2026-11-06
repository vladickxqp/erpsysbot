/**
 * The company's own data: what every invoice names about the seller, and
 * how invoices are numbered, taxed and paid.
 *
 * The country is not changed here (only the platform admin does that): it was
 * chosen at sign-up and decides which tax numbers and bank details are
 * checked, and how. The currency may change only while no invoice has been
 * issued — issued figures keep the currency they were issued in.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { documents, invoices, organizations } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { countryProfile, parseRate, validTaxId } from "@/lib/countries";
import { INVOICE_FILE_KINDS } from "@/lib/invoicing";
import { validNumberPattern } from "./money";
import type { Context } from "./context";
import { NotFoundError } from "./clients";
import { requirePermission } from "./permissions";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

/** The company form, checked against the company's country. */
export function companyInputFor(country: string) {
  const profile = countryProfile(country);
  return z.object({
    name: z.string().trim().min(2).max(120),
    legalName: text(200),
    street: text(160),
    postalCode: text(20),
    city: text(100),
    vatId: text(40).refine((v) => v === null || validTaxId(v, profile.vatIdPattern), "vatId"),
    taxNumber: text(40).refine((v) => v === null || validTaxId(v, profile.taxNumberPattern), "taxNumber"),
    email: z
      .string()
      .trim()
      .max(200)
      .nullish()
      .transform((v) => v || null)
      .refine((v) => v === null || z.string().email().safeParse(v).success, "email"),
    phone: text(40),
    website: text(200),
    /** An IBAN where the country's banks use one, else the account number as written. */
    iban: z
      .string()
      .trim()
      .max(40)
      .nullish()
      .transform((v) => (v ? (profile.iban ? v.replace(/\s+/g, "").toUpperCase() : v) : null))
      .refine((v) => v === null || !profile.iban || /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v), "iban"),
    bic: text(30),
    bankName: text(100),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine((c) => CURRENCIES.has(c), "currency")
      .optional(),
    /** "19, 7" → [19, 7]; empty → the country's rates. */
    taxRates: z
      .union([z.string(), z.array(z.number())])
      .nullish()
      .transform((v, ctx) => {
        const parts = Array.isArray(v) ? v.map(String) : (v ?? "").split(/[;\s]+|,(?=\s)|,$/).filter(Boolean);
        if (!parts.length) return null;
        const rates = parts.map(parseRate);
        if (rates.some((r) => r === null) || rates.length > 10) {
          ctx.addIssue({ code: "custom", message: "taxRates" });
          return z.NEVER;
        }
        return [...new Set(rates as number[])];
      }),
    smallBusiness: z
      .boolean()
      .default(false)
      .transform((v) => v && profile.smallBusiness !== null),
    paymentTermsDays: z.coerce.number().int().min(0).max(120).default(14),
    invoiceNumberFormat: z.string().trim().min(3).max(40).refine(validNumberPattern, "number").default(profile.numbers.invoice),
    creditNoteNumberFormat: z.string().trim().min(3).max(40).refine(validNumberPattern, "number").default(profile.numbers.creditNote),
    einvoiceFormat: z.enum(INVOICE_FILE_KINDS).default("PDF"),
    quoteNumberFormat: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .refine((v) => /\{N+\}/.test(v), "number")
      .default(profile.numbers.quote),
    invoiceFooter: text(500),
  });
}
export type CompanyInput = z.input<ReturnType<typeof companyInputFor>>;

/** True once the company has issued an invoice: its currency is then fixed. */
export async function currencyLocked(organizationId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), sql`${invoices.status} <> 'DRAFT'`))
    .limit(1);
  return !!row;
}

export async function updateCompany(ctx: Context, raw: CompanyInput) {
  requirePermission(ctx.permissions, "settings.manage");
  const input = companyInputFor(ctx.organization.country).parse(raw);
  if (input.currency && input.currency !== ctx.organization.currency && (await currencyLocked(ctx.organization.id))) {
    throw new z.ZodError([{ code: "custom", path: ["currency"], message: "locked" }]);
  }
  const [row] = await getDb()
    .update(organizations)
    .set(input)
    .where(eq(organizations.id, ctx.organization.id))
    .returning();
  return row;
}

/** The picture on invoices and quotes: a PNG or JPEG from the documents store, or none. */
export async function setCompanyLogo(ctx: Context, documentId: string | null): Promise<void> {
  requirePermission(ctx.permissions, "settings.manage");
  if (documentId) {
    const [doc] = await withTenant(ctx.organization.id, (tx) => tx.select({ mimeType: documents.mimeType }).from(documents).where(eq(documents.id, documentId)));
    if (!doc || !["image/png", "image/jpeg"].includes(doc.mimeType)) throw new NotFoundError();
  }
  await getDb().update(organizations).set({ logoDocumentId: documentId }).where(eq(organizations.id, ctx.organization.id));
}
