import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { NotFoundError } from "@/server/clients";
import { getInvoice, missingCompanyData } from "@/server/invoices";
import { totals, today } from "@/server/money";
import { asLines } from "@/server/orders";
import { requirePageContext } from "@/server/request";
import { mailAvailable } from "@/server/mail";
import { listReminders } from "@/server/reminders";
import { InvoiceDetail } from "./invoice-detail";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("invoices.read");
  const { t } = await getT();
  const found = await getInvoice(ctx, (await params).id).catch(() => null);
  return { title: found ? (found.invoice.number ?? t("invoices.draftNumber")) : undefined };
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("invoices.read");
  const { id } = await params;
  const found = await getInvoice(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { invoice, items, payments, client, clientName, related } = found;
  const now = today(ctx.organization.timezone);
  const reminders = await listReminders(ctx, id);
  return (
    <InvoiceDetail
      invoice={{
        id: invoice.id,
        kind: invoice.kind,
        status: invoice.status,
        number: invoice.number,
        clientId: invoice.clientId,
        orderId: invoice.orderId,
        issueDate: invoice.issueDate,
        serviceDate: invoice.serviceDate,
        dueDate: invoice.dueDate,
        notes: invoice.notes,
        grossCents: invoice.grossCents,
        paidCents: invoice.paidCents,
        smallBusiness: invoice.smallBusiness,
        overdue:
          invoice.kind === "INVOICE" && ["ISSUED", "PARTIALLY_PAID"].includes(invoice.status) && !!invoice.dueDate && invoice.dueDate < now,
      }}
      clientName={clientName}
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
      totals={totals(asLines(items), invoice.smallBusiness)}
      payments={payments.map((p) => ({ id: p.id, amountCents: p.amountCents, paidOn: p.paidOn, method: p.method }))}
      related={related}
      missingCompany={missingCompanyData(ctx.organization)}
      today={now}
      clientEmail={client?.email ?? null}
      mail={mailAvailable()}
      reminders={reminders.map((r) => ({
        id: r.id,
        level: r.level,
        issueDate: r.issueDate,
        dueDate: r.dueDate,
        openCents: r.openCents,
        sentAt: r.sentAt?.toISOString() ?? null,
      }))}
      can={{
        edit: ctx.permissions.has("invoices.create"),
        issue: ctx.permissions.has("invoices.issue"),
        cancel: ctx.permissions.has("invoices.cancel"),
        pay: ctx.permissions.has("finance.create"),
        settings: ctx.permissions.has("settings.manage"),
      }}
    />
  );
}
