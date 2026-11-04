import { getT } from "@/i18n/server";
import { clientOptions } from "@/server/clients";
import { listContent } from "@/server/content";
import { requirePageContext } from "@/server/request";
import { listSponsorships } from "@/server/sponsorships";
import { SponsorsView } from "./sponsors-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("sponsors.title") };
}

export default async function SponsorsPage() {
  const ctx = await requirePageContext("content.manage");
  const deals = await listSponsorships(ctx);
  const clients = ctx.permissions.has("clients.read") ? await clientOptions(ctx) : [];
  const content = await listContent(ctx);
  return (
    <SponsorsView
      canManage={ctx.permissions.has("content.manage")}
      canInvoice={ctx.permissions.has("invoices.create")}
      clients={clients.map((c) => ({ id: c.id, name: c.name }))}
      content={content.slice(0, 200).map((c) => ({ id: c.id, name: c.title }))}
      deals={deals.map((d) => ({
        id: d.id,
        brand: d.brand,
        title: d.title,
        status: d.status,
        amountCents: d.amountCents,
        dueDate: d.dueDate,
        clientId: d.clientId,
        contentId: d.contentId,
        contentTitle: d.contentTitle,
        invoiceId: d.invoiceId,
        notes: d.notes,
      }))}
    />
  );
}
