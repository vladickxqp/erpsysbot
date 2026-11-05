import { Search } from "lucide-react";
import Link from "next/link";
import { SearchBox } from "@/components/app/list-controls";
import { EmptyState, PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { requireContext } from "@/server/request";
import { SEARCH_KINDS, searchSmart, type SearchKind } from "@/server/search";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("common.search") };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; page?: string }> }) {
  const ctx = await requireContext();
  const { t } = await getT();
  const { q, kind: wanted, page } = await searchParams;
  const only = (SEARCH_KINDS as readonly string[]).includes(wanted ?? "") ? (wanted as SearchKind) : null;
  const pageNumber = Math.max(1, Number(page) || 1);
  const size = only ? 25 : 8;
  const { hits, more, intent } = await searchSmart(ctx, q ?? "", { kinds: only ? [only] : undefined, offset: (pageNumber - 1) * size, limit: size });
  const kinds = [...new Set(hits.map((h) => h.kind))];
  const link = (kind: string, to: number) => `/app/search?q=${encodeURIComponent(q ?? "")}&kind=${kind}&page=${to}`;
  return (
    <>
      <PageHeader title={t("common.search")} />
      <div className="mb-4">
        <SearchBox placeholder={t("common.search")} />
      </div>
      {intent && <p className="mb-3 text-sm text-muted-foreground">{t("hub.palette.understood", { kind: t(`searchPage.kind.${intent.kind}`) })}</p>}
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
              <div className="mt-1 flex gap-3 text-sm">
                {only && pageNumber > 1 && (
                  <Link href={link(kind, pageNumber - 1)} className="text-primary hover:underline">
                    {t("common.back")}
                  </Link>
                )}
                {more.includes(kind) && (
                  <Link href={link(kind, only ? pageNumber + 1 : 1)} className="text-primary hover:underline">
                    {t("hub.palette.more")}
                  </Link>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
