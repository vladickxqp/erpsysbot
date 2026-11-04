import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { clientOptions, NotFoundError } from "@/server/clients";
import { getInvoice } from "@/server/invoices";
import { listProducts } from "@/server/products";
import { requirePageContext } from "@/server/request";
import { InvoiceEditor } from "./invoice-editor";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("invoices.create");
  const { t } = await getT();
  const { id } = await params;
  const found = await getInvoice(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  // An issued invoice is not edited; there is a page for it, not a form.
  if (found.invoice.status !== "DRAFT") redirect(`/app/invoices/${id}`);
  const [clients, products] = await Promise.all([clientOptions(ctx), listProducts(ctx, { activeOnly: true })]);
  const { invoice, items } = found;
  return (
    <>
      <PageHeader title={t("invoices.edit")} />
      <InvoiceEditor
        invoice={{
          id: invoice.id,
          clientId: invoice.clientId,
          serviceDate: invoice.serviceDate ?? "",
          dueDate: invoice.dueDate ?? "",
          notes: invoice.notes ?? "",
          currency: invoice.currency ?? undefined,
          exchangeRate: invoice.exchangeRate ? String(invoice.exchangeRate) : undefined,
        }}
        items={items.map((i) => ({
          productId: i.productId,
          description: i.description,
          quantity: i.quantity,
          unit: i.unit,
          unitPriceCents: i.unitPriceCents,
          discountPercent: i.discountPercent,
          vatRate: i.vatRate,
        }))}
        clients={clients}
        products={products}
        smallBusiness={ctx.organization.smallBusiness}
      />
    </>
  );
}
