import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { personalOverview } from "@/server/personal";
import { requireContext, requireModule } from "@/server/request";
import { PersonalView } from "./personal-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("personal.title") };
}

export default async function PersonalPage() {
  const ctx = await requireContext();
  requireModule(ctx, "personal");
  const { t } = await getT();
  const data = await personalOverview(ctx);
  return (
    <>
      <PageHeader title={t("personal.title")} />
      <PersonalView today={data.today} goals={data.goals.map((g) => ({ id: g.id, title: g.title, targetDate: g.targetDate, progress: g.progress }))} habits={data.habits} />
    </>
  );
}
