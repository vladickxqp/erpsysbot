import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { invoiceFormProps } from "../form-props";
import { requirePageContext } from "@/server/request";
import { InvoiceForm } from "../invoice-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("invoices.new") };
}

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const ctx = await requirePageContext("invoices.create");
  const { t } = await getT();
  const { client } = await searchParams;
  const props = await invoiceFormProps(ctx);
  const preset = props.clients.find((c) => c.id === client)?.id;
  return (
    <>
      <PageHeader title={t("invoices.new")} />
      <InvoiceForm {...props} initial={preset ? { clientId: preset } : undefined} />
    </>
  );
}
