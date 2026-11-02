"use client";

import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/client";
import { resetAction, type AuthState } from "../../actions";

export function ResetForm({ token }: { token: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<AuthState, FormData>(resetAction, undefined);
  const [, startSubmit] = useTransition();
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("auth.newPassword")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startSubmit(() => action(data));
          }}
        >
          <input type="hidden" name="token" value={token} />
          <div className="grid gap-2">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus />
            <span className="text-xs text-muted-foreground">{t("auth.passwordHint")}</span>
          </div>
          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {t(`auth.${state.error}`)}
            </p>
          )}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? t("common.loading") : t("common.save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
