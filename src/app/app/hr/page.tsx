import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { awayBetween, myAbsences, pendingAbsences, staffList, vacationBalance } from "@/server/hr";
import { addDays, today } from "@/server/money";
import { requireContext, requireModule } from "@/server/request";
import { HrView } from "./hr-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("hub.hr.title") };
}

export default async function HrPage() {
  const ctx = await requireContext();
  requireModule(ctx, "hr");
  const { t } = await getT();
  const day = today(ctx.organization.timezone);
  const [mine, balance, away] = [await myAbsences(ctx), await vacationBalance(ctx, ctx.user.userId, day.slice(0, 4)), await awayBetween(ctx, day, addDays(day, 60))];
  const canManage = ctx.permissions.has("hr.manage");
  const canRead = ctx.permissions.has("hr.read");
  const requests = canManage ? await pendingAbsences(ctx) : [];
  const staff = canRead ? await staffList(ctx) : [];
  return (
    <>
      <PageHeader title={t("hub.hr.title")} />
      <HrView
        today={day}
        me={ctx.user.userId}
        mine={mine.map((a) => ({ id: a.id, kind: a.kind, startDate: a.startDate, endDate: a.endDate, status: a.status }))}
        balance={balance}
        away={away}
        requests={requests.map((a) => ({ id: a.id, name: a.name, userId: a.userId, kind: a.kind, startDate: a.startDate, endDate: a.endDate, note: a.note }))}
        staff={staff.map((s) => ({ id: s.id, name: s.name, position: s.profile?.position ?? "", hireDate: s.profile?.hireDate ?? "", vacationDays: s.profile?.vacationDays ?? 30, phone: s.profile?.phone ?? "", emergencyContact: s.profile?.emergencyContact ?? "", notes: s.profile?.notes ?? "" }))}
        canManage={canManage}
        canRead={canRead}
      />
    </>
  );
}
