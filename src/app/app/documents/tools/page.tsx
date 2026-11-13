import { FolderOpen } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";
import { assistantAvailable } from "@/server/assistant/run";
import { clientOptions } from "@/server/clients";
import { DOCX, listTemplates, orderChoices } from "@/server/doc-tools";
import { listDocuments } from "@/server/documents";
import { requirePageContext } from "@/server/request";
import { DocTools } from "./doc-tools";

/** The kinds of files the tools take. */
const CONVERTIBLE = new Set([DOCX, "application/pdf", "text/plain", "image/png", "image/jpeg"]);

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("docs.title") };
}

export default async function DocToolsPage() {
  const ctx = await requirePageContext("documents.manage");
  const { t } = await getT();
  const [templates, docs, clients, orders] = await Promise.all([
    listTemplates(ctx),
    listDocuments(ctx, {}),
    ctx.permissions.has("clients.read") ? clientOptions(ctx) : Promise.resolve([]),
    ctx.permissions.has("orders.read") ? orderChoices(ctx) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader
        title={t("docs.title")}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/app/documents">
              <FolderOpen className="size-4" /> {t("documents.title")}
            </Link>
          </Button>
        }
      />
      <DocTools
        templates={templates.map((tpl) => ({ id: tpl.id, name: tpl.name, body: tpl.body, sourceDocumentId: tpl.sourceDocumentId, sourceName: tpl.sourceName, fields: tpl.fields }))}
        files={docs.filter((d) => CONVERTIBLE.has(d.mimeType)).map((d) => ({ id: d.id, name: d.name, mimeType: d.mimeType }))}
        clients={clients.map((c) => ({ id: c.id, name: `${c.name} (#${c.number})` }))}
        orders={orders}
        ai={ctx.permissions.has("ai.use") && assistantAvailable()}
      />
    </>
  );
}
