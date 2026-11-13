import "server-only";
import { notFound, redirect } from "next/navigation";
import { assistantAvailable } from "@/server/assistant/run";
import { listCategories } from "@/server/catalog";
import { NotFoundError } from "@/server/clients";
import type { Context } from "@/server/context";
import { webhookUrl } from "@/server/shop-payments";
import { checklist, getStore, productChoices, storeImages } from "@/server/stores";
import type { EditorProps } from "./store-editor";

/** Everything the editor shows of one site. A store is edited under /app/store, a website under /app/sites. */
export async function editorProps(ctx: Context, id: string, place: "store" | "sites"): Promise<EditorProps> {
  const store = await getStore(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const selling = store.kind === "store";
  if (selling !== (place === "store")) redirect(selling ? `/app/store/${id}` : `/app/sites/${id}`);
  const [checks, images, categories, products] = await Promise.all([
    checklist(ctx, id),
    storeImages(ctx, store.kind),
    selling ? listCategories(ctx) : Promise.resolve([]),
    selling ? productChoices(ctx) : Promise.resolve([]),
  ]);
  return {
    store: {
      id: store.id,
      kind: store.kind,
      name: store.name,
      slug: store.slug,
      status: store.status,
      changed: store.changed,
      locale: store.locale,
      contactEmail: store.contactEmail,
      categoryIds: store.categoryIds,
      shipCountries: store.shipCountries,
      design: store.design,
      theme: store.theme,
      blocks: store.blocks,
      customPages: store.customPages,
      pages: store.pages,
      shipping: store.shipping,
      payments: store.payments,
      stripe: store.stripe,
    },
    checks,
    images,
    categories: categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId })),
    products,
    webhookUrl: selling ? webhookUrl(store.id) : null,
    company: { iban: !!ctx.organization.iban, country: ctx.organization.country },
    can: { settings: ctx.permissions.has("settings.manage"), ai: ctx.permissions.has("ai.use") && assistantAvailable() },
  };
}
