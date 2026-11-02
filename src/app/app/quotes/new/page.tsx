import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { clientOptions } from "@/server/clients";
import { listProducts } from "@/server/products";
import { requirePageContext } from "@/server/request";
import { QuoteForm } from "../quote-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("quotes.new") };
}

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const ctx = await requirePageContext("orders.create");
  const { t } = await getT();
  const { client } = await searchParams;
  const [clients, products] = await Promise.all([clientOptions(ctx), listProducts(ctx, { activeOnly: true })]);
  const preset = clients.find((c) => c.id === client)?.id;
  return (
    <>
      <PageHeader title={t("quotes.new")} />
      <QuoteForm
        clients={clients}
        products={products}
        smallBusiness={ctx.organization.smallBusiness}
        initial={preset ? { clientId: preset, title: "", notes: "", validUntil: "", lines: [] } : undefined}
      />
    </>
  );
}
