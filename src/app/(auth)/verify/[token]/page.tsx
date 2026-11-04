import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { verifyEmail } from "@/server/auth/email-verification";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("security.verifyTitle") };
}

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { t } = await getT();
  const ok = await verifyEmail((await params).token);
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("security.verifyTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <p className={ok ? "text-success" : "text-destructive"}>{t(ok ? "security.verifyDone" : "auth.expired")}</p>
        <Button asChild>
          <Link href="/app">{t("nav.dashboard")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
