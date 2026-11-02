import { getT } from "@/i18n/server";
import { listAutomations } from "@/server/automations";
import { requirePageContext } from "@/server/request";
import { memberOptions } from "@/server/team";
import { AutomationsView } from "./automations-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("automation.title") };
}

export default async function AutomationsPage() {
  const ctx = await requirePageContext("automation.manage");
  const [{ rules, runs }, members] = await Promise.all([listAutomations(ctx), memberOptions(ctx)]);
  return (
    <AutomationsView
      members={members}
      rules={rules.map((r) => ({
        id: r.id,
        name: r.name,
        trigger: r.trigger,
        conditions: r.conditions as Record<string, unknown>,
        action: r.action,
        params: r.params as Record<string, unknown>,
        enabled: r.enabled,
      }))}
      runs={runs.map((r) => ({ id: r.id, name: r.name, subject: r.subject, ok: r.ok, message: r.message, attempts: r.attempts, createdAt: r.createdAt.toISOString() }))}
    />
  );
}
