"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/client";
import { loginAction, type AuthState } from "../actions";

export function LoginForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<AuthState, FormData>(loginAction, undefined);
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("auth.login")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {t(`auth.${state.error}`)}
            </p>
          )}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? t("common.loading") : t("auth.login")}
          </Button>
          <p className="text-sm text-muted-foreground text-center">
            {t("auth.noAccount")}{" "}
            <Link href="/register" className="text-primary font-medium hover:underline">
              {t("auth.register")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
