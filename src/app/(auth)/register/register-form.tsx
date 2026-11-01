"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/client";
import { registerAction, type AuthState } from "../actions";

export function RegisterForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<AuthState, FormData>(registerAction, undefined);
  const bad = (field: string) => state?.fields?.includes(field) || undefined;
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("auth.register")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="company">{t("auth.company")}</Label>
            <Input id="company" name="company" required minLength={2} maxLength={120} aria-invalid={bad("company")} autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="name">{t("auth.name")}</Label>
            <Input id="name" name="name" autoComplete="name" required minLength={2} maxLength={100} aria-invalid={bad("name")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={bad("email")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              aria-invalid={bad("password")}
              aria-describedby="password-hint"
            />
            <p id="password-hint" className="text-xs text-muted-foreground">
              {t("auth.passwordHint")}
            </p>
          </div>
          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {t(`auth.${state.error}`)}
            </p>
          )}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? t("common.loading") : t("auth.register")}
          </Button>
          <p className="text-sm text-muted-foreground text-center">
            {t("auth.haveAccount")}{" "}
            <Link href="/login" className="text-primary font-medium hover:underline">
              {t("auth.login")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
