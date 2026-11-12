import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { listCategories } from "@/server/catalog";
import { NotFoundError } from "@/server/clients";
import { requirePageContext } from "@/server/request";
import { webhookUrl } from "@/server/shop-payments";
import { checklist, getStore, productChoices, storeImages } from "@/server/stores";
import { StoreEditor } from "./store-editor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
  const ctx = await requirePageContext("products.manage");
  const store = await getStore(ctx, (await params).id).catch(() => null);
  return { title: store?.name ?? t("store.title") };
}

export default async function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("products.manage");
  const { id } = await params;
  const store = await getStore(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [checks, images, categories, products] = await Promise.all([checklist(ctx, id), storeImages(ctx), listCategories(ctx), productChoices(ctx)]);
  return (
    <StoreEditor
      store={{
        id: store.id,
        name: store.name,
        slug: store.slug,
        status: store.status,
        locale: store.locale,
        contactEmail: store.contactEmail,
        categoryIds: store.categoryIds,
        shipCountries: store.shipCountries,
        design: store.design,
        blocks: store.blocks,
        pages: store.pages,
        shipping: store.shipping,
        payments: store.payments,
        stripe: store.stripe,
      }}
      checks={checks}
      images={images}
      categories={categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }))}
      products={products}
      webhookUrl={webhookUrl(store.id)}
      company={{ iban: !!ctx.organization.iban, country: ctx.organization.country }}
      can={{ settings: ctx.permissions.has("settings.manage") }}
    />
  );
}
