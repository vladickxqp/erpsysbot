import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/i18n";
import { getT } from "@/i18n/server";
import { IMPORT_FIELDS } from "@/lib/product-import";
import { listImports } from "@/server/product-import";
import { requirePageContext } from "@/server/request";
import { ImportUpload } from "./import-upload";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("catalog.import.title") };
}

export default async function ImportPage() {
  const ctx = await requirePageContext("products.manage");
  const { t, locale, region } = await getT();
  const imports = await listImports(ctx);
  return (
    <>
      <Link href="/app/products" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("products.title")}
      </Link>
      <PageHeader title={t("catalog.import.title")} />
      <div className="grid max-w-3xl gap-6">
        <ImportUpload />
        <div className="flex flex-wrap gap-1">
          {IMPORT_FIELDS.map((f) => (
            <Badge key={f} variant="outline">
              {t(`catalog.import.field.${f}`)}
            </Badge>
          ))}
        </div>
        {imports.length > 0 && (
          <ul className="grid gap-2">
            {imports.map((i) => (
              <li key={i.id}>
                <Link href={`/app/products/import/${i.id}`} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm hover:border-primary/40">
                  <span className="min-w-0 truncate font-medium">{i.fileName}</span>
                  <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                    {formatDate(i.createdAt, locale, region)}
                    <Badge variant={i.status === "APPLIED" ? "secondary" : "outline"}>{t(`catalog.import.status.${i.status}`)}</Badge>
                    {i.status === "APPLIED" && <span className="tabular-nums">{t("catalog.count", { count: i.createdCount })}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
