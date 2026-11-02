import { notFound } from "next/navigation";
import { NotFoundError } from "@/server/clients";
import { mailAvailable } from "@/server/mail";
import { today, totals } from "@/server/money";
import { asLines } from "@/server/orders";
import { getQuote } from "@/server/quotes";
import { requirePageContext } from "@/server/request";
import { QuoteDetail } from "./quote-detail";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("orders.read");
  const found = await getQuote(ctx, (await params).id).catch(() => null);
  return { title: found?.quote.number };
}

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("orders.read");
  const { id } = await params;
  const found = await getQuote(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { quote, items, client, clientName } = found;
  const open = quote.status === "DRAFT" || quote.status === "SENT";
  return (
    <QuoteDetail
      quote={{
        id: quote.id,
        number: quote.number,
        status: quote.status,
        title: quote.title,
        notes: quote.notes,
        issueDate: quote.issueDate,
        validUntil: quote.validUntil,
        clientId: quote.clientId,
        orderId: quote.orderId,
        invoiceId: quote.invoiceId,
        expired: open && !!quote.validUntil && quote.validUntil < today(ctx.organization.timezone),
      }}
      clientName={clientName}
      clientEmail={client?.email ?? null}
      items={items.map((i) => ({
        id: i.id,
        position: i.position,
        description: i.description,
        quantity: Number(i.quantity),
        unit: i.unit,
        unitPriceCents: i.unitPriceCents,
        discountPercent: Number(i.discountPercent),
        vatRate: i.vatRate,
        netCents: i.netCents,
      }))}
      totals={totals(asLines(items), quote.smallBusiness)}
      smallBusiness={quote.smallBusiness}
      mail={mailAvailable()}
      can={{
        update: ctx.permissions.has("orders.update"),
        delete: ctx.permissions.has("orders.delete"),
        order: ctx.permissions.has("orders.create"),
        invoice: ctx.permissions.has("invoices.create"),
      }}
    />
  );
}
