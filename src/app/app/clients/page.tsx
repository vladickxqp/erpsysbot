import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { displayName, listClients, SORTS, type ClientSort } from "@/server/clients";
import { requirePageContext } from "@/server/request";
import { ClientsView } from "./clients-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("clients.title") };
}

type Search = { q?: string; status?: string; sort?: string; page?: string };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requirePageContext("clients.read");
  const { t } = await getT();
  const sp = await searchParams;
  const status = ["LEAD", "ACTIVE", "INACTIVE"].includes(sp.status ?? "") ? (sp.status as "LEAD") : undefined;
  const sort = (SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as ClientSort) : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const { rows, total, pageSize } = await listClients(ctx, { q: sp.q, status, sort, page, archived: sp.status === "ARCHIVED" });
  return (
    <>
      <PageHeader title={t("clients.title")} />
      <ClientsView
        rows={rows.map((r) => ({
          id: r.id,
          number: r.number,
          name: displayName(r),
          email: r.email,
          phone: r.phone,
          city: r.city,
          status: r.status,
          tags: r.tags,
          createdAt: r.createdAt.toISOString(),
        }))}
        total={total}
        page={page}
        pages={Math.max(1, Math.ceil(total / pageSize))}
        canCreate={ctx.permissions.has("clients.create")}
      />
    </>
  );
}
