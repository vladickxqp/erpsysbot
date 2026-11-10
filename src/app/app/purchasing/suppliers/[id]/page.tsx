import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { getSupplierDetail } from "@/server/catalog";
import { NotFoundError } from "@/server/clients";
import { requirePageContext } from "@/server/request";
import { SupplierView } from "./supplier-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("inventory.supplier") };
}

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageContext("orders.read");
  const detail = await getSupplierDetail(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const s = detail.supplier;
  return (
    <SupplierView
      id={s.id}
      canManage={ctx.permissions.has("inventory.manage")}
      initial={{
        name: s.name,
        contactName: s.contactName ?? "",
        email: s.email ?? "",
        phone: s.phone ?? "",
        street: s.street ?? "",
        postalCode: s.postalCode ?? "",
        city: s.city ?? "",
        country: s.country,
        notes: s.notes ?? "",
        website: s.website ?? "",
        currency: s.currency ?? "",
        paymentTermsDays: s.paymentTermsDays?.toString() ?? "",
        shippingTerms: s.shippingTerms ?? "",
        deliveryDays: s.deliveryDays?.toString() ?? "",
        returnConditions: s.returnConditions ?? "",
        status: s.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      }}
      offers={detail.offers.map((o) => ({
        id: o.id,
        productId: o.product.id,
        productName: o.product.name,
        sku: o.supplierSku ?? o.product.sku,
        variant: o.variant,
        purchasePriceCents: o.purchasePriceCents,
        currency: o.currency,
        leadTimeDays: o.leadTimeDays,
        preferred: o.preferred,
      }))}
      performance={detail.performance}
    />
  );
}
