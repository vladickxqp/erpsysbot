import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { currentUser } from "@/server/request";
import { accountExists, findInvitation } from "@/server/team";
import { AcceptButton, JoinForm } from "./invite-forms";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("invite.title") };
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getT();
  const invite = await findInvitation(token);
  if (!invite) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t("auth.expired")}</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const user = await currentUser();
  const header = (
    <CardHeader>
      <CardTitle className="text-xl">{invite.company}</CardTitle>
      <p className="text-sm text-muted-foreground">
        {invite.email} · {t(`settings.${invite.role}`)}
      </p>
    </CardHeader>
  );

  if (user) {
    const same = user.email.toLowerCase() === invite.email;
    return (
      <Card className="shadow-sm">
        {header}
        <CardContent className="grid gap-3">
          {same ? (
            <AcceptButton token={token} />
          ) : (
            <>
              <p className="text-sm text-destructive">{t("auth.wrongEmail")}</p>
              <form action={logoutAction}>
                <Button type="submit" variant="outline" className="w-full">
                  {t("auth.logout")}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  if (await accountExists(invite.email)) {
    return (
      <Card className="shadow-sm">
        {header}
        <CardContent>
          <Button asChild className="w-full">
            <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>{t("auth.login")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      {header}
      <CardContent>
        <JoinForm token={token} />
      </CardContent>
    </Card>
  );
}
