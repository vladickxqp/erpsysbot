import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { shipmentMap, type MapFilter } from "@/server/geo";
import { requirePageContext } from "@/server/request";
import { ShipmentsView } from "./shipments-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("tracking.title") };
}

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await requirePageContext("orders.read");
  const { t } = await getT();
  const filter: MapFilter = (await searchParams).filter === "recent" ? "recent" : "open";
  const parcels = await shipmentMap(ctx, filter);
  return (
    <>
      <PageHeader title={t("tracking.title")} />
      <ShipmentsView key={filter} parcels={parcels} filter={filter} />
    </>
  );
}
