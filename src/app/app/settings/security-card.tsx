"use client";

import { KeyRound, LogOut, MailWarning, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { intlTag } from "@/i18n";
import { useI18n } from "@/i18n/client";
import {
  changePasswordAction,
  confirmTwoFactorAction,
  disableTwoFactorAction,
  endOtherSessionsAction,
  endSessionAction,
  recoveryCodesAction,
  resendVerificationAction,
  startTwoFactorAction,
  type SecurityResult,
} from "./actions";

type Session = { id: string; createdAt: string; userAgent: string | null; ipCountry: string | null; current: boolean };

/** "Chrome · Windows" from a user agent, roughly. */
function device(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" · ");
}

type Step = { kind: "password" } | { kind: "setup"; secret: string; qr: string } | { kind: "codes"; codes: string[] } | { kind: "disable" } | { kind: "renew" } | null;

export function SecurityCard({ enabled, unverified, recoveryLeft, sessions }: { enabled: boolean; unverified: boolean; recoveryLeft: number; sessions: Session[] }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState<Step>(null);
  const [code, setCode] = useState("");
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, start] = useTransition();
  const when = (iso: string) => new Intl.DateTimeFormat(intlTag(locale, region), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  const run = (work: () => Promise<SecurityResult>, then: (r: SecurityResult) => void) =>
    start(async () => {
      const res = await work();
      if (res.error) toast.error(t(res.error));
      else then(res);
      router.refresh();
    });

  const submitCode = () => {
    if (!step) return;
    if (step.kind === "password") run(() => startTwoFactorAction(code), (r) => setStep({ kind: "setup", secret: r.secret!, qr: r.qr! }));
    if (step.kind === "setup") run(() => confirmTwoFactorAction(code), (r) => setStep({ kind: "codes", codes: r.codes ?? [] }));
    if (step.kind === "disable") run(() => disableTwoFactorAction(code), () => setStep(null));
    if (step.kind === "renew") run(() => recoveryCodesAction(code), (r) => setStep({ kind: "codes", codes: r.codes ?? [] }));
    setCode("");
  };

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4" /> {t("security.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {unverified && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5">
            <MailWarning className="size-4 text-warning" aria-hidden />
            <span className="min-w-0 flex-1">{t("security.unverified")}</span>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(resendVerificationAction, () => toast.success(t("security.linkSent")))}>
              {t("security.sendLink")}
            </Button>
          </div>
        )}
        <div>
          <Button size="sm" variant="outline" onClick={() => setChanging(true)}>
            <KeyRound className="size-3.5" /> {t("security.changePassword")}
          </Button>
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{t("security.twoFactor")}</span>
            <Badge variant="outline" className={enabled ? "border-success/30 bg-success/10 text-success" : ""}>
              {enabled ? t("security.on") : t("security.off")}
            </Badge>
          </div>
          {enabled ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("security.codesLeft", { count: String(recoveryLeft) })}</span>
              <Button size="sm" variant="outline" onClick={() => setStep({ kind: "renew" })}>
                {t("security.newCodes")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setStep({ kind: "disable" })}>
                {t("security.disable")}
              </Button>
            </div>
          ) : (
            <div>
              <Button size="sm" disabled={pending} onClick={() => setStep({ kind: "password" })}>
                {t("security.enable")}
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{t("security.sessions")}</span>
            {sessions.length > 1 && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(endOtherSessionsAction, () => toast.success(t("security.signedOutOthers")))}>
                <LogOut className="size-3.5" /> {t("security.signOutOthers")}
              </Button>
            )}
          </div>
          <div className="grid divide-y rounded-lg border">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    {device(s.userAgent)}
                    {s.ipCountry && <span className="text-muted-foreground"> · {s.ipCountry}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{when(s.createdAt)}</div>
                </div>
                {s.current ? (
                  <Badge variant="secondary">{t("security.thisDevice")}</Badge>
                ) : (
                  <Button size="icon" variant="ghost" className="size-7" disabled={pending} onClick={() => run(() => endSessionAction(s.id), () => undefined)} aria-label={t("auth.logout")}>
                    <LogOut className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </CardContent>

      <Dialog open={changing} onOpenChange={setChanging}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("security.changePassword")}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => changePasswordAction(current, next),
                () => {
                  toast.success(t("common.saved"));
                  setChanging(false);
                  setCurrent("");
                  setNext("");
                },
              );
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="pw-current">{t("security.currentPassword")}</Label>
              <Input id="pw-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-next">{t("auth.newPassword")}</Label>
              <Input id="pw-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!step} onOpenChange={(v) => !v && setStep(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{step?.kind === "codes" ? t("security.recoveryCodes") : step?.kind === "disable" ? t("security.disable") : t("security.twoFactor")}</DialogTitle>
          </DialogHeader>
          {step?.kind === "codes" ? (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">{t("security.codesOnce")}</p>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-3 font-mono text-sm">
                {step.codes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(step.codes.join("\n")).then(() => toast.success(t("studio.gen.copied")))}>
                  {t("studio.gen.copy")}
                </Button>
                <Button onClick={() => setStep(null)}>{t("widgets.done")}</Button>
              </DialogFooter>
            </div>
          ) : (
            step && (
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitCode();
                }}
              >
                {step.kind === "setup" && (
                  <>
                    <p className="text-sm text-muted-foreground">{t("security.scan")}</p>
                    <div className="mx-auto w-48 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: step.qr }} />
                    <code className="break-all rounded bg-muted px-2 py-1 text-center text-xs">{step.secret}</code>
                  </>
                )}
                {step.kind === "password" ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="sec-password">{t("auth.password")}</Label>
                    <Input id="sec-password" type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="current-password" autoFocus required />
                  </div>
                ) : (
                  <div className="grid gap-1.5">
                    <Label htmlFor="sec-code">{t("auth.code")}</Label>
                    <Input id="sec-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus required maxLength={12} />
                  </div>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={pending || !code.trim()}>
                    {t("security.confirm")}
                  </Button>
                </DialogFooter>
              </form>
            )
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
