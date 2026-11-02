import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { registrationAllowed } from "@/server/accounts";
import { findPlatformInvite } from "@/server/platform";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("auth.register") };
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  if (invite && (await findPlatformInvite(invite))) return <RegisterForm invite={invite} />;
  if (await registrationAllowed()) return <RegisterForm />;
  const { t } = await getT();
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("auth.closed")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Link href="/login" className="text-sm font-medium text-primary hover:underline">
          {t("auth.login")}
        </Link>
      </CardContent>
    </Card>
  );
}
