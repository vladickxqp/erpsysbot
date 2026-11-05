import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { personalMoney, personalOverview } from "@/server/personal";
import { requireContext, requireModule } from "@/server/request";
import { PersonalMoney } from "./personal-money";
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
  const money = await personalMoney(ctx, data.today.slice(0, 7));
  return (
    <>
      <PageHeader title={t("personal.title")} />
      <PersonalView today={data.today} goals={data.goals.map((g) => ({ id: g.id, title: g.title, targetDate: g.targetDate, progress: g.progress }))} habits={data.habits} />
      <PersonalMoney today={data.today} inCents={money.inCents} outCents={money.outCents} rows={money.rows.map((r) => ({ id: r.id, kind: r.kind, amountCents: r.amountCents, bookedOn: r.bookedOn, description: r.description }))} />
    </>
  );
}
