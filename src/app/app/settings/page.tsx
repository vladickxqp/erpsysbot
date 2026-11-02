import { PageHeader } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { requireContext } from "@/server/request";
import { botToken } from "@/server/settings";
import { linkOfUser } from "@/server/telegram/links";
import { CompanyForm } from "./company-form";
import { TelegramCard } from "./telegram-card";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("settings.title") };
}

export default async function SettingsPage() {
  const ctx = await requireContext();
  const { t } = await getT();
  const o = ctx.organization;
  const telegram = botToken() ? await linkOfUser(ctx.user.userId) : undefined;
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CompanyForm
            canEdit={ctx.permissions.has("settings.manage")}
            initial={{
              name: o.name,
              legalName: o.legalName ?? "",
              street: o.street ?? "",
              postalCode: o.postalCode ?? "",
              city: o.city ?? "",
              country: o.country,
              vatId: o.vatId ?? "",
              taxNumber: o.taxNumber ?? "",
              email: o.email ?? "",
              phone: o.phone ?? "",
              website: o.website ?? "",
              iban: o.iban ?? "",
              bic: o.bic ?? "",
              bankName: o.bankName ?? "",
              smallBusiness: o.smallBusiness,
              paymentTermsDays: o.paymentTermsDays,
              invoiceNumberFormat: o.invoiceNumberFormat,
              invoiceFooter: o.invoiceFooter ?? "",
            }}
          />
        </div>
        <div className="grid h-fit gap-4">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">{t("settings.profile")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="font-medium">{ctx.user.name}</div>
              <div className="text-muted-foreground">{ctx.user.email}</div>
              <div>
                <Badge variant="secondary">{t(`settings.${ctx.role}`)}</Badge>
              </div>
            </CardContent>
          </Card>
          {telegram !== undefined && (
            <TelegramCard linked={telegram ? { name: telegram.username ? `@${telegram.username}` : "Telegram" } : null} />
          )}
        </div>
      </div>
    </>
  );
}
