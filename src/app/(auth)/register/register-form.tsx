"use client";

import Link from "next/link";
import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/client";
import { registerAction, type AuthState } from "../actions";

export function RegisterForm({ invite, countries }: { invite?: string; countries: { code: string; name: string }[] }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<AuthState, FormData>(registerAction, undefined);
  const [, startSubmit] = useTransition();
  const bad = (field: string) => state?.fields?.includes(field) || undefined;
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("auth.register")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            // By hand, so a wrong password does not also empty the email.
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            data.set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
            startSubmit(() => action(data));
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="company">{t("auth.company")}</Label>
            <Input id="company" name="company" required minLength={2} maxLength={120} aria-invalid={bad("company")} autoFocus />
            {invite && <input type="hidden" name="invite" value={invite} />}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="country">{t("company.country")}</Label>
            {/* Native: typing jumps through 247 countries, phones open their own picker. */}
            <select
              id="country"
              name="country"
              required
              defaultValue=""
              aria-invalid={bad("country")}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30 [&>option]:bg-background [&>option]:text-foreground"
            >
              <option value="" disabled>
                —
              </option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
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
