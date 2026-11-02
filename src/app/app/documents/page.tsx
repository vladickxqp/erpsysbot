import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { clientOptions } from "@/server/clients";
import { listDocuments } from "@/server/documents";
import { requirePageContext } from "@/server/request";
import { DocumentsView } from "./documents-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("documents.title") };
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ q?: string; client?: string; archived?: string }> }) {
  const ctx = await requirePageContext("documents.read");
  const { t } = await getT();
  const sp = await searchParams;
  const archived = sp.archived === "1";
  const [docs, clients] = await Promise.all([
    listDocuments(ctx, { q: sp.q, clientId: sp.client, archived }),
    ctx.permissions.has("clients.read") ? clientOptions(ctx) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title={t("documents.title")} />
      <DocumentsView
        archived={archived}
        canManage={ctx.permissions.has("documents.manage")}
        clients={clients}
        client={sp.client ?? null}
        docs={docs.map((d) => ({
          id: d.id,
          name: d.name,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          category: d.category,
          clientId: d.clientId,
          clientName: d.clientName,
          createdAt: d.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
