import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { choiceLabel } from "@/lib/variants";
import { NotFoundError } from "@/server/clients";
import { importPreview } from "@/server/product-import";
import { requirePageContext } from "@/server/request";
import { ImportView } from "./import-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("catalog.import.title") };
}

/** Rows sent to the page: every faulty one first (they need a look), then the start of the rest. */
const SHOWN = 300;

export default async function ImportPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageContext("products.manage");
  const preview = await importPreview(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const faulty = preview.rows.filter((r) => r.errors.length);
  const shown = [...faulty, ...preview.rows.filter((r) => !r.errors.length)].slice(0, SHOWN).sort((a, b) => a.line - b.line);
  return (
    <ImportView
      id={preview.id}
      fileName={preview.fileName}
      status={preview.status as "PREVIEW" | "APPLIED" | "DISCARDED"}
      createdCount={preview.createdCount}
      header={preview.header}
      mapping={preview.mapping}
      summary={preview.summary}
      total={preview.rows.length}
      rows={shown.map((r) => ({
        line: r.line,
        name: r.name,
        sku: r.sku,
        parentSku: r.parentSku,
        variant: r.variant ? choiceLabel(r.variant) : null,
        category: r.category,
        priceCents: r.priceCents,
        purchasePriceCents: r.purchasePriceCents,
        stock: r.stock,
        supplier: r.supplier,
        errors: r.errors,
      }))}
    />
  );
}
