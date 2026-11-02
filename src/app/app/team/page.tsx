import { PageHeader } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { requirePageContext } from "@/server/request";
import { listTeam } from "@/server/team";
import { TeamView } from "./team-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("team.title") };
}

export default async function TeamPage() {
  const ctx = await requirePageContext("employees.read");
  const { t } = await getT();
  const { members, pending } = await listTeam(ctx);
  return (
    <>
      <PageHeader title={t("team.title")} />
      <TeamView
        me={ctx.user.userId}
        myRole={ctx.role}
        canManage={ctx.permissions.has("employees.manage")}
        members={members.map((m) => ({ ...m, since: m.since.toISOString() }))}
        pending={pending.map((p) => ({ ...p, expiresAt: p.expiresAt.toISOString() }))}
      />
    </>
  );
}
