import { notFound, redirect } from "next/navigation";
import { toEditable } from "@/components/app/line-editor";
import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { NotFoundError } from "@/server/clients";
import { getInvoice } from "@/server/invoices";
import { requirePageContext } from "@/server/request";
import { invoiceFormProps } from "../../form-props";
import { InvoiceForm } from "../../invoice-form";

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
  const { invoice, items } = found;
  return (
    <>
      <PageHeader title={t("invoices.edit")} />
      <InvoiceForm
        {...(await invoiceFormProps(ctx))}
        initial={{
          id: invoice.id,
          clientId: invoice.clientId,
          title: invoice.title ?? "",
          invoiceDate: invoice.issueDate ?? undefined,
          serviceDate: invoice.serviceDate ?? "",
          serviceEndDate: invoice.serviceEndDate ?? "",
          dueDate: invoice.dueDate ?? "",
          notes: invoice.notes ?? "",
          currency: invoice.currency ?? undefined,
          exchangeRate: invoice.exchangeRate ? String(invoice.exchangeRate) : undefined,
          taxTreatment: invoice.taxTreatment,
          exemptionReason: invoice.exemptionReason ?? "",
          language: invoice.language,
          templateId: invoice.templateId ?? "",
          lines: toEditable(items.map((i) => ({ productId: i.productId, description: i.description, quantity: i.quantity, unit: i.unit, unitPriceCents: i.unitPriceCents, discountPercent: i.discountPercent, vatRate: i.vatRate }))),
        }}
      />
    </>
  );
}
