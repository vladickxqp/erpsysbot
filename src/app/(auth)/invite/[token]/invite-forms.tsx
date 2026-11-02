"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/client";
import { acceptInviteAction, joinAction, type AuthState } from "../../actions";

export function AcceptButton({ token }: { token: string }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`auth.${error}`)}
        </p>
      )}
      <Button
        className="w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await acceptInviteAction(token);
            if (result?.error) setError(result.error);
          })
        }
      >
        {pending ? t("common.loading") : t("invite.join")}
      </Button>
    </>
  );
}

export function JoinForm({ token }: { token: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<AuthState, FormData>(joinAction, undefined);
  const [, startSubmit] = useTransition();
  return (
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
        <Label htmlFor="name">{t("auth.name")}</Label>
        <Input id="name" name="name" autoComplete="name" required minLength={2} autoFocus />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        <span className="text-xs text-muted-foreground">{t("auth.passwordHint")}</span>
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`auth.${state.error}`)}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? t("common.loading") : t("invite.join")}
      </Button>
    </form>
  );
}
