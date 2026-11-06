import { invoiceClients } from "@/server/clients";
import type { Context } from "@/server/context";
import { listInvoiceTemplates } from "@/server/invoice-templates";
import { sellerOf } from "@/server/invoices";
import { today } from "@/server/money";
import { listProducts } from "@/server/products";
import { availableTreatments, styleOf } from "@/lib/invoicing";

/** Everything the invoice form starts from: the company writes none of it again. */
export async function invoiceFormProps(ctx: Context) {
  const org = ctx.organization;
  const [clients, products, templates] = await Promise.all([invoiceClients(ctx), listProducts(ctx, { activeOnly: true }), listInvoiceTemplates(ctx)]);
  return {
    clients,
    products,
    treatments: availableTreatments(org.country, org.smallBusiness),
    templates: templates.map((x) => ({ ...styleOf(x), id: x.id, name: x.name, language: x.language, isDefault: x.isDefault })),
    seller: sellerOf(org),
    logoId: org.logoDocumentId,
    paymentTermsDays: org.paymentTermsDays,
    today: today(org.timezone),
    canIssue: ctx.permissions.has("invoices.issue"),
    canCreateClient: ctx.permissions.has("clients.create"),
    canUpdateClient: ctx.permissions.has("clients.update"),
    defaultLanguage: org.locale,
  };
}
