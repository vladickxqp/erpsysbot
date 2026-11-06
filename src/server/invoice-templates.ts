/**
 * How a company's invoices look: layout, colour, language, footer and payment
 * text. Issued invoices keep the look they were issued with, so a template can
 * change or go at any time. A company without any gets the built-in look.
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { invoiceTemplates } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { LOCALES } from "@/i18n";
import { DEFAULT_ACCENT, HEX_COLOR, INVOICE_LAYOUTS } from "@/lib/invoicing";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

export type InvoiceTemplate = typeof invoiceTemplates.$inferSelect;

const MAX_TEMPLATES = 20;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const templateInput = z.object({
  name: z.string().trim().min(1).max(60),
  layout: z.enum(INVOICE_LAYOUTS).default("CLASSIC"),
  accentColor: z.string().trim().regex(HEX_COLOR).default(DEFAULT_ACCENT),
  language: z.enum(LOCALES).default("de"),
  footer: text(500),
  paymentInstructions: text(500),
  isDefault: z.boolean().default(false),
});
export type TemplateInput = z.input<typeof templateInput>;

export class TemplateError extends Error {
  constructor(public readonly code: "NAME_TAKEN" | "TOO_MANY") {
    super(code);
  }
}

export async function listInvoiceTemplates(ctx: Context): Promise<InvoiceTemplate[]> {
  return withTenant(ctx.organization.id, (tx) => tx.select().from(invoiceTemplates).orderBy(asc(invoiceTemplates.name)));
}

export async function saveInvoiceTemplate(ctx: Context, id: string | null, raw: TemplateInput): Promise<InvoiceTemplate> {
  requirePermission(ctx.permissions, "settings.manage");
  const input = templateInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    const same = await tx
      .select({ id: invoiceTemplates.id })
      .from(invoiceTemplates)
      .where(and(sql`lower(${invoiceTemplates.name}) = lower(${input.name})`, id ? ne(invoiceTemplates.id, id) : undefined))
      .limit(1);
    if (same.length) throw new TemplateError("NAME_TAKEN");
    if (!id) {
      const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(invoiceTemplates);
      if (total >= MAX_TEMPLATES) throw new TemplateError("TOO_MANY");
    }
    // Only one is the default: the index on the table holds that.
    if (input.isDefault) await tx.update(invoiceTemplates).set({ isDefault: false }).where(eq(invoiceTemplates.isDefault, true));
    const [row] = id
      ? await tx.update(invoiceTemplates).set({ ...input, updatedAt: new Date() }).where(eq(invoiceTemplates.id, id)).returning()
      : await tx.insert(invoiceTemplates).values({ ...input, organizationId: ctx.organization.id }).returning();
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, id ? "invoice_template.update" : "invoice_template.create", "invoice_template", row.id, { name: row.name });
    return row;
  });
}

export async function deleteInvoiceTemplate(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "settings.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(invoiceTemplates).where(eq(invoiceTemplates.id, id)).returning();
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "invoice_template.delete", "invoice_template", id, { name: row.name });
  });
}
