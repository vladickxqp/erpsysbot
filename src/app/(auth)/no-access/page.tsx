import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.noAccess") };
}

export default async function NoAccessPage() {
  const { t } = await getT();
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("admin.noAccess")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" className="w-full">
            {t("auth.logout")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
