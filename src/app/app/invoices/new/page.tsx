import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { clientOptions } from "@/server/clients";
import { listProducts } from "@/server/products";
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
  const [clients, products] = await Promise.all([clientOptions(ctx), listProducts(ctx, { activeOnly: true })]);
  const preset = clients.find((c) => c.id === client)?.id;
  return (
    <>
      <PageHeader title={t("invoices.new")} />
      <InvoiceForm
        clients={clients}
        products={products}
        smallBusiness={ctx.organization.smallBusiness}
        initial={preset ? { clientId: preset, serviceDate: "", dueDate: "", notes: "", lines: [] } : undefined}
      />
    </>
  );
}
