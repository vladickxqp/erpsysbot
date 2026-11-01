/**
 * The company's own data: what every invoice names about the seller, and
 * how invoices are numbered and paid.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const companyInput = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: text(200),
  street: text(160),
  postalCode: text(20),
  city: text(100),
  country: z.string().trim().toUpperCase().length(2).default("DE"),
  vatId: text(40),
  taxNumber: text(40),
  email: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || z.string().email().safeParse(v).success, "email"),
  phone: text(40),
  website: text(200),
  iban: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .transform((v) => (v ? v.replace(/\s+/g, "").toUpperCase() : null))
    .refine((v) => v === null || /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v), "iban"),
  bic: text(15),
  bankName: text(100),
  smallBusiness: z.boolean().default(false),
  paymentTermsDays: z.coerce.number().int().min(0).max(120).default(14),
  invoiceNumberFormat: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .refine((v) => /\{N+\}/.test(v), "number")
    .default("RE-{YYYY}-{NNNN}"),
  invoiceFooter: text(500),
});
export type CompanyInput = z.input<typeof companyInput>;

export async function updateCompany(ctx: Context, raw: CompanyInput) {
  requirePermission(ctx.permissions, "settings.manage");
  const input = companyInput.parse(raw);
  const [row] = await getDb()
    .update(organizations)
    .set(input)
    .where(eq(organizations.id, ctx.organization.id))
    .returning();
  return row;
}
