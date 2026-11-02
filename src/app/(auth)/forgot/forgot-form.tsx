"use client";

import Link from "next/link";
import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/client";
import { forgotAction, type AuthState } from "../actions";

export function ForgotForm({ mail }: { mail: boolean }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<AuthState, FormData>(forgotAction, undefined);
  const [, startSubmit] = useTransition();
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("auth.forgot")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!mail ? (
          <p className="text-sm text-muted-foreground">{t("auth.askAdmin")}</p>
        ) : state?.sent ? (
          <p role="status" className="text-sm">
            {t("auth.resetSent")}
          </p>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              startSubmit(() => action(data));
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
            </div>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? t("common.loading") : t("auth.sendLink")}
            </Button>
          </form>
        )}
        <Link href="/login" className="text-center text-sm font-medium text-primary hover:underline">
          {t("auth.login")}
        </Link>
      </CardContent>
    </Card>
  );
}
