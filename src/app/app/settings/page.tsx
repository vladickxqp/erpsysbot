import { PageHeader } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { currencyLocked } from "@/server/company";
import { requireContext } from "@/server/request";
import { botToken } from "@/server/settings";
import { linkOfUser } from "@/server/telegram/links";
import { listSessions, recoveryCodesLeft, twoFactorEnabled } from "@/server/auth/two-factor";
import { CompanyForm } from "./company-form";
import { PrivacyCard } from "./privacy-card";
import { SecurityCard } from "./security-card";
import { ModulesCard } from "./modules-card";
import { TelegramCard } from "./telegram-card";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("settings.title") };
}

export default async function SettingsPage() {
  const ctx = await requireContext();
  const { t, locale } = await getT();
  const o = ctx.organization;
  const telegram = botToken() ? await linkOfUser(ctx.user.userId) : undefined;
  const [twoFactor, recoveryLeft, sessions] = [await twoFactorEnabled(ctx.user.userId), await recoveryCodesLeft(ctx.user.userId), await listSessions(ctx.user.userId)];
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid h-fit gap-4 lg:col-span-2">
          <CompanyForm
            country={o.country}
            countryName={new Intl.DisplayNames([locale], { type: "region" }).of(o.country) ?? o.country}
            currencyLocked={await currencyLocked(o.id)}
            canEdit={ctx.permissions.has("settings.manage")}
            initial={{
              name: o.name,
              legalName: o.legalName ?? "",
              street: o.street ?? "",
              postalCode: o.postalCode ?? "",
              city: o.city ?? "",
              vatId: o.vatId ?? "",
              taxNumber: o.taxNumber ?? "",
              email: o.email ?? "",
              phone: o.phone ?? "",
              website: o.website ?? "",
              iban: o.iban ?? "",
              bic: o.bic ?? "",
              bankName: o.bankName ?? "",
              currency: o.currency,
              taxRates: (o.taxRates ?? []).join("; "),
              smallBusiness: o.smallBusiness,
              paymentTermsDays: o.paymentTermsDays,
              invoiceNumberFormat: o.invoiceNumberFormat,
              quoteNumberFormat: o.quoteNumberFormat,
              invoiceFooter: o.invoiceFooter ?? "",
            }}
          />
          <ModulesCard companyOff={[...ctx.disabledModules]} myOff={[...ctx.hiddenModules]} canManage={ctx.permissions.has("settings.manage")} />
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
          <SecurityCard
            enabled={twoFactor}
            recoveryLeft={recoveryLeft}
            sessions={sessions.map((s) => ({ ...s, createdAt: s.createdAt.toISOString(), current: s.id === ctx.user.sessionId }))}
          />
          <PrivacyCard owner={ctx.role === "OWNER"} companyName={o.name} />
          {telegram !== undefined && (
            <TelegramCard linked={telegram ? { name: telegram.username ? `@${telegram.username}` : "Telegram", notify: telegram.notify } : null} />
          )}
        </div>
      </div>
    </>
  );
}
