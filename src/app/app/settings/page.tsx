import { PageHeader } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { requireContext } from "@/server/request";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("settings.title") };
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default async function SettingsPage() {
  const ctx = await requireContext();
  const { t } = await getT();
  const org = ctx.organization;
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.company")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Row label={t("auth.company")} value={org.name} />
              <Row label={t("clients.vatId")} value={org.vatId ?? "—"} />
              <Row label={t("clients.country")} value={org.country} />
              <Row label="Währung / Currency" value={org.currency} />
              <Row label="Zeitzone / Timezone" value={org.timezone} />
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.profile")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Row label={t("auth.name")} value={ctx.user.name} />
              <Row label={t("auth.email")} value={ctx.user.email} />
              <Row label={t("settings.role")} value={<Badge variant="secondary">{t(`settings.${ctx.role}`)}</Badge>} />
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
