import { Sections } from "./sections";
import { shopOf } from "./store";

export default async function SiteHome({ params }: { params: Promise<{ slug: string }> }) {
  const store = await shopOf((await params).slug);
  return <Sections store={store} sections={store.blocks} />;
}
