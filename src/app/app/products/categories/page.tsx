import { getT } from "@/i18n/server";
import { listCategories } from "@/server/catalog";
import { requirePageContext } from "@/server/request";
import { CategoriesView } from "./categories-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("catalog.categories") };
}

export default async function CategoriesPage() {
  const ctx = await requirePageContext("products.manage");
  const categories = await listCategories(ctx);
  return <CategoriesView categories={categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId, products: c.products }))} />;
}
