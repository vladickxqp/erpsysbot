import { PageHeader } from "@/components/app/page";
import { listDepartments, listUnits } from "@/server/departments";
import { PERMISSIONS } from "@/server/permissions";
import { getT } from "@/i18n/server";
import { requirePageContext } from "@/server/request";
import { listCustomRoles, listTeam } from "@/server/team";
import { TeamView } from "./team-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("team.title") };
}

export default async function TeamPage() {
  const ctx = await requirePageContext("employees.read");
  const { t } = await getT();
  const { members, pending } = await listTeam(ctx);
  const departments = await listDepartments(ctx);
  const customRoles = await listCustomRoles(ctx);
  const units = await listUnits(ctx);
  return (
    <>
      <PageHeader title={t("team.title")} />
      <TeamView
        me={ctx.user.userId}
        myRole={ctx.role}
        canManage={ctx.permissions.has("employees.manage")}
        departments={departments.map((d) => ({ id: d.id, name: d.name, unitId: d.unitId }))}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        allPermissions={PERMISSIONS}
        customRoles={customRoles.map((r) => ({ id: r.id, name: r.name, permissions: r.permissions }))}
        myPermissions={[...ctx.permissions]}
        members={members.map((m) => ({ ...m, since: m.since.toISOString() }))}
        pending={pending.map((p) => ({ ...p, expiresAt: p.expiresAt.toISOString() }))}
      />
    </>
  );
}
