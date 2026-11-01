import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { clientOptions } from "@/server/clients";
import { listProducts } from "@/server/products";
import { requireContext } from "@/server/request";
import { OrderForm } from "../order-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("orders.new") };
}

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const ctx = await requireContext();
  const { t } = await getT();
  const { client } = await searchParams;
  const [clients, products] = await Promise.all([clientOptions(ctx), listProducts(ctx, { activeOnly: true })]);
  const preset = clients.find((c) => c.id === client)?.id;
  return (
    <>
      <PageHeader title={t("orders.new")} />
      <OrderForm
        clients={clients}
        products={products}
        smallBusiness={ctx.organization.smallBusiness}
        initial={preset ? { clientId: preset, status: "NEW", title: "", notes: "", dueDate: "", lines: [] } : undefined}
      />
    </>
  );
}
