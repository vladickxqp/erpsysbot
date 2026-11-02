import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { passwordTokenValid } from "@/server/team";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("auth.newPassword") };
}

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (await passwordTokenValid(token)) return <ResetForm token={token} />;
  const { t } = await getT();
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("auth.expired")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Link href="/forgot" className="text-sm font-medium text-primary hover:underline">
          {t("auth.forgot")}
        </Link>
      </CardContent>
    </Card>
  );
}
