"use client";

import Link from "next/link";
import { useActionState, useTransition } from "react";
import { PasswordInput } from "@/components/app/password-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/client";
import { loginAction, loginCodeAction, type AuthState } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<AuthState, FormData>(loginAction, undefined);
  const [codeState, codeAction, codePending] = useActionState<AuthState, FormData>(loginCodeAction, undefined);
  const [, startSubmit] = useTransition();
  // The code step belongs to the latest password step; an expired one sends back to the password.
  const challenge = state?.challenge && state.challenge !== codeState?.expired ? state.challenge : undefined;

  if (challenge) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t("auth.twoFactor")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              startSubmit(() => codeAction(data));
            }}
          >
            <input type="hidden" name="challenge" value={challenge} />
            {next && <input type="hidden" name="next" value={next} />}
            <div className="grid gap-2">
              <Label htmlFor="code">{t("auth.code")}</Label>
              <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={12} />
            </div>
            {codeState?.error === "code" && codeState.challenge === challenge && (
              <p role="alert" className="text-sm text-destructive">
                {t("auth.code_wrong")}
              </p>
            )}
            <Button type="submit" disabled={codePending} className="w-full">
              {codePending ? t("common.loading") : t("auth.login")}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("auth.login")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            // By hand, so a wrong password does not also empty the email.
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startSubmit(() => action(data));
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
          </div>
          {next && <input type="hidden" name="next" value={next} />}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Link href="/forgot" className="text-xs text-muted-foreground hover:text-primary hover:underline">
                {t("auth.forgot")}
              </Link>
            </div>
            <PasswordInput id="password" name="password" autoComplete="current-password" required />
          </div>
          {(state?.error || (codeState?.error === "codeExpired" && state?.challenge === codeState.expired)) && (
            <p role="alert" className="text-sm text-destructive">
              {t(`auth.${codeState?.error === "codeExpired" && state?.challenge === codeState.expired ? "codeExpired" : state!.error}`)}
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
