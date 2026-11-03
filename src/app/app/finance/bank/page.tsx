import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { BANK_STATUSES, listBank } from "@/server/bank";
import { requirePageContext } from "@/server/request";
import { BankView } from "./bank-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("bank.title") };
}

export default async function BankPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requirePageContext("finance.read");
  const { t } = await getT();
  const sp = await searchParams;
  const status = (BANK_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof BANK_STATUSES)[number]) : "NEW";
  const { rows, open } = await listBank(ctx, status);
  return (
    <>
      <PageHeader title={t("bank.title")} />
      <BankView
        status={status}
        canBook={ctx.permissions.has("finance.create")}
        open={open}
        rows={rows.map((r) => ({
          id: r.id,
          bookedOn: r.bookedOn,
          amountCents: r.amountCents,
          counterparty: r.counterparty,
          purpose: r.purpose,
          invoiceId: r.invoiceId,
          suggestions: r.suggestions.map((s) => ({ invoiceId: s.invoiceId, label: `${s.number ?? "—"} · ${s.clientName}`, sure: s.sure })),
        }))}
      />
    </>
  );
}
