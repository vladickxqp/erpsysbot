import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Sections } from "../sections";
import { shopOf } from "../store";

/** A page the company made itself, at /shop/<site>/<page>. */
async function load(slug: string, page: string) {
  const store = await shopOf(slug);
  const found = store.customPages.find((p) => p.slug === page);
  if (!found) notFound();
  return { store, page: found };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; page: string }> }): Promise<Metadata> {
  const { slug, page } = await params;
  return { title: (await load(slug, page)).page.title };
}

export default async function SitePageView({ params }: { params: Promise<{ slug: string; page: string }> }) {
  const { slug, page: name } = await params;
  const { store, page } = await load(slug, name);
  const first = page.sections.find((s) => !s.hidden);
  return (
    <>
      {/* Every page has its main heading: a hero brings it, otherwise the page's title does. */}
      {first?.type !== "hero" && (
        <header className="mx-auto w-full max-w-[var(--site-container)] px-4 pb-2 pt-14 sm:pt-20">
          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">{page.title}</h1>
        </header>
      )}
      <Sections store={store} sections={page.sections} />
    </>
  );
}
