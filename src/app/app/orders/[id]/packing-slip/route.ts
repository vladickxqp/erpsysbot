import { formatDate, isLocale, MESSAGES, regionOf, translator } from "@/i18n";
import { countryProfile } from "@/lib/countries";
import { NotFoundError } from "@/server/clients";
import { getOrder } from "@/server/orders";
import { tablePdf } from "@/server/pdf";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

/** The delivery note: what goes into the parcel and where it goes, without prices. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const locale = isLocale(ctx.user.locale) ? ctx.user.locale : "de";
  const t = translator(MESSAGES[locale]);
  const region = regionOf(ctx.organization);
  try {
    const { order, items, clientName } = await getOrder(ctx, (await params).id);
    const address = [order.shipName ?? clientName, order.shipStreet, [order.shipPostalCode, order.shipCity].filter(Boolean).join(" "), order.shipCountry].filter(Boolean).join(", ");
    const qty = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
    const pdf = await tablePdf({
      paper: countryProfile(ctx.organization.country).paper,
      company: ctx.organization.name,
      title: `${t("orderFlow.packingSlip")} #${order.number}`,
      subtitle: [address, formatDate(new Date(), locale, region), order.externalRef].filter(Boolean).join(" · "),
      columns: [
        { label: "#", align: "left" },
        { label: t("orderFlow.item"), align: "left" },
        { label: t("orderFlow.quantity"), align: "right" },
        { label: t("orderFlow.unit"), align: "left" },
        { label: t("orderFlow.checked"), align: "left" },
      ],
      rows: items.map((i) => [String(i.position), i.description.split("\n")[0], qty.format(Number(i.quantity)), i.unit, "☐"]),
    });
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${t("orderFlow.packingSlip").replace(/[^\w.-]+/g, "_")}_${order.number}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
