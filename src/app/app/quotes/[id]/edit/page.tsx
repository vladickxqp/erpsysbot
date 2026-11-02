import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { clientOptions, NotFoundError } from "@/server/clients";
import { listProducts } from "@/server/products";
import { getQuote } from "@/server/quotes";
import { requirePageContext } from "@/server/request";
import { QuoteEditor } from "../../quote-form";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("orders.update");
  const { t } = await getT();
  const { id } = await params;
  const found = await getQuote(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { quote, items } = found;
  if (quote.status === "ACCEPTED" || quote.status === "DECLINED") redirect(`/app/quotes/${id}`);
  const [clients, products] = await Promise.all([clientOptions(ctx), listProducts(ctx, { activeOnly: true })]);
  return (
    <>
      <PageHeader title={`${t("quotes.edit")} ${quote.number}`} />
      <QuoteEditor
        quote={{ id: quote.id, clientId: quote.clientId, title: quote.title ?? "", notes: quote.notes ?? "", validUntil: quote.validUntil ?? "" }}
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
