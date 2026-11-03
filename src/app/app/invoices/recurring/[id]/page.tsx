import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { clientOptions } from "@/server/clients";
import { linesInput, today } from "@/server/money";
import { listProducts } from "@/server/products";
import { listRecurring } from "@/server/recurring";
import { requirePageContext } from "@/server/request";
import { RecurringForm } from "./recurring-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("recurring.title") };
}

export default async function RecurringEditPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("invoices.create");
  const { t } = await getT();
  const { id } = await params;
  const [plans, clients, products] = await Promise.all([listRecurring(ctx), clientOptions(ctx), listProducts(ctx, { activeOnly: true })]);
  const plan = id === "new" ? null : plans.find((p) => p.id === id);
  if (id !== "new" && !plan) notFound();
  return (
    <>
      <PageHeader title={plan ? plan.clientName : t("recurring.new")} />
      <RecurringForm
        id={plan?.id ?? null}
        clients={clients}
        products={products}
        smallBusiness={ctx.organization.smallBusiness}
        canIssue={ctx.permissions.has("invoices.issue")}
        initial={{
          clientId: plan?.clientId ?? "",
          title: plan?.title ?? "",
          interval: (plan?.interval as "MONTHLY") ?? "MONTHLY",
          startDate: plan?.nextDate ?? today(ctx.organization.timezone),
          endDate: plan?.endDate ?? "",
          autoIssue: plan?.autoIssue ?? false,
          autoSend: plan?.autoSend ?? false,
          items: plan ? linesInput.parse(plan.items) : [],
        }}
      />
    </>
  );
}
