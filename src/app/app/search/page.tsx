import { Search } from "lucide-react";
import Link from "next/link";
import { SearchBox } from "@/components/app/list-controls";
import { EmptyState, PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { requireContext } from "@/server/request";
import { searchAll } from "@/server/search";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("common.search") };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext();
  const { t } = await getT();
  const { q } = await searchParams;
  const hits = await searchAll(ctx, q ?? "");
  const kinds = [...new Set(hits.map((h) => h.kind))];
  return (
    <>
      <PageHeader title={t("common.search")} />
      <div className="mb-4">
        <SearchBox placeholder={t("common.search")} />
      </div>
      {hits.length === 0 ? (
        <EmptyState icon={Search} title={t("searchPage.nothing")} />
      ) : (
        <div className="grid gap-4">
          {kinds.map((kind) => (
            <section key={kind}>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t(`searchPage.kind.${kind}`)}</h2>
              <div className="divide-y rounded-xl border bg-card">
                {hits
                  .filter((h) => h.kind === kind)
                  .map((h) => (
                    <Link key={h.id} href={h.href} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40">
                      <span className="min-w-0 flex-1 truncate font-medium">{h.title}</span>
                      {h.hint && <span className="truncate text-xs text-muted-foreground">{h.hint}</span>}
                    </Link>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
