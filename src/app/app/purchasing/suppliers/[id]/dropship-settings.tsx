"use client";

import { Copy, KeyRound, PlugZap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { isAllowedUrl, SUBMIT_METHODS, type DropshipRules, type LinkState, type SubmitMethod } from "@/lib/dropship";
import { cn } from "@/lib/utils";
import { saveDropshipAction, signingSecretAction, testSupplierLinkAction } from "../../dropship-actions";

export type DropshipSettingsProps = {
  supplierId: string;
  canManage: boolean;
  initial: {
    dropship: boolean;
    submitMethod: SubmitMethod;
    orderEmail: string | null;
    apiUrl: string | null;
    apiKeyHint: string | null;
    hasSecret: boolean;
    processingDays: number | null;
    rules: DropshipRules;
    state: LinkState;
    lastSubmitAt: string | null;
    lastError: string | null;
    callbackUrl: string | null;
  };
};

const STATE_TONE: Record<LinkState, string> = {
  OFF: "",
  SETUP: "border-warning/40 bg-warning/10 text-warning",
  CONFIGURED: "",
  CONNECTED: "border-success/20 bg-success/10 text-success",
  ERROR: "border-destructive/30 bg-destructive/10 text-destructive",
};

const amount = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));
const parse = (text: string) => {
  const t = text.trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
};

export function DropshipSettings({ supplierId, canManage, initial }: DropshipSettingsProps) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [secret, setSecret] = useState<string | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [v, setV] = useState({
    dropship: initial.dropship,
    submitMethod: initial.submitMethod,
    orderEmail: initial.orderEmail ?? "",
    apiUrl: initial.apiUrl ?? "",
    apiKey: "",
    removeApiKey: false,
    processingDays: initial.processingDays?.toString() ?? "",
    autoBelow: amount(initial.rules.autoBelowCents),
    minMargin: initial.rules.minMarginPercent?.toString().replace(".", ",") ?? "",
    approveNewSupplier: initial.rules.approveNewSupplier,
    approvePriceChange: initial.rules.approvePriceChange,
    approveUnknownStock: initial.rules.approveUnknownStock,
    requirePaid: initial.rules.requirePaid,
  });
  const set = (patch: Partial<typeof v>) => setV((old) => ({ ...old, ...patch }));
  const disabled = !canManage;

  const save = () => {
    const auto = parse(v.autoBelow);
    const margin = v.minMargin.trim() ? Number(v.minMargin.trim().replace(",", ".")) : null;
    const days = v.processingDays.trim() ? Number(v.processingDays.trim()) : null;
    if (Number.isNaN(auto) || (margin !== null && !Number.isFinite(margin)) || (days !== null && !Number.isInteger(days)) || (v.apiUrl.trim() && !isAllowedUrl(v.apiUrl.trim()))) {
      toast.error(t(v.apiUrl.trim() && !isAllowedUrl(v.apiUrl.trim()) ? "dropship.error.URL" : "auth.check"));
      return;
    }
    start(async () => {
      const result = await saveDropshipAction(supplierId, {
        dropship: v.dropship,
        submitMethod: v.submitMethod,
        orderEmail: v.orderEmail,
        apiUrl: v.apiUrl,
        apiKey: v.apiKey,
        removeApiKey: v.removeApiKey,
        processingDays: days,
        rules: {
          autoBelowCents: auto === null ? null : Math.round(auto * 100),
          minMarginPercent: margin,
          approveNewSupplier: v.approveNewSupplier,
          approvePriceChange: v.approvePriceChange,
          approveUnknownStock: v.approveUnknownStock,
          requirePaid: v.requirePaid,
        },
      });
      if (result.ok) {
        toast.success(t("common.saved"));
        set({ apiKey: "", removeApiKey: false });
        router.refresh();
      } else toast.error(t(result.error ?? "common.error"));
    });
  };

  const test = () =>
    start(async () => {
      const result = await testSupplierLinkAction(supplierId);
      if (!result.ok || !result.test) return void toast.error(t(result.error ?? "common.error"));
      if (result.test.ok) toast.success(`${t("dropship.settings.testOk")}${result.test.status ? ` (${result.test.status})` : ""}`);
      else toast.error(`${t("dropship.settings.testFailed")}: ${t(`dropship.error.${result.test.error ?? "UNAVAILABLE"}`)}${result.test.status ? ` (${result.test.status})` : ""}`);
    });

  const showSecret = (renew: boolean) =>
    start(async () => {
      const result = await signingSecretAction(supplierId, renew);
      if (result.ok && result.secret) setSecret(result.secret);
      else toast.error(t(result.error ?? "common.error"));
    });

  const copy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(t("dropship.settings.copied")))
      .catch(() => toast.error(t("common.error")));

  const check = (key: "approveNewSupplier" | "approvePriceChange" | "approveUnknownStock" | "requirePaid", label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={v[key]} onCheckedChange={(c) => set({ [key]: c === true })} disabled={disabled || !v.dropship} /> {label}
    </label>
  );

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugZap className="size-4" /> {t("dropship.settings.title")}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline" className={cn(STATE_TONE[initial.state])}>
            {t(`dropship.link.${initial.state}`)}
          </Badge>
          {initial.lastSubmitAt && (
            <span className="text-muted-foreground">
              {t("dropship.settings.lastSubmit")}: {formatDate(initial.lastSubmitAt, locale, region)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-5 lg:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid h-fit gap-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={v.dropship} onCheckedChange={(c) => set({ dropship: c === true })} disabled={disabled} /> {t("dropship.settings.dropship")}
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">{t("dropship.settings.method")}</span>
              <Select value={v.submitMethod} onValueChange={(m) => set({ submitMethod: m as SubmitMethod })} disabled={disabled || !v.dropship}>
                <SelectTrigger className="w-full" aria-label={t("dropship.settings.method")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBMIT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`dropship.method.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {v.submitMethod === "EMAIL" && (
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("dropship.settings.orderEmail")}</span>
                <Input type="email" value={v.orderEmail} maxLength={200} onChange={(e) => set({ orderEmail: e.target.value })} disabled={disabled || !v.dropship} />
              </label>
            )}
            {v.submitMethod === "API" && (
              <>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("dropship.settings.apiUrl")}</span>
                  <Input type="url" value={v.apiUrl} maxLength={500} placeholder="https://" onChange={(e) => set({ apiUrl: e.target.value })} disabled={disabled || !v.dropship} />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("dropship.settings.apiKey")}</span>
                  <Input
                    type="password"
                    autoComplete="off"
                    value={v.apiKey}
                    maxLength={1000}
                    placeholder={initial.apiKeyHint && !v.removeApiKey ? t("dropship.settings.apiKeySaved", { hint: initial.apiKeyHint }) : ""}
                    onChange={(e) => set({ apiKey: e.target.value, removeApiKey: false })}
                    disabled={disabled || !v.dropship}
                  />
                </label>
                {initial.apiKeyHint && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={v.removeApiKey} onCheckedChange={(c) => set({ removeApiKey: c === true, apiKey: "" })} disabled={disabled} /> {t("dropship.settings.removeKey")}
                  </label>
                )}
              </>
            )}
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">{t("dropship.settings.processingDays")}</span>
              <Input inputMode="numeric" value={v.processingDays} onChange={(e) => set({ processingDays: e.target.value })} disabled={disabled || !v.dropship} />
            </label>
            {initial.lastError && initial.state === "ERROR" && (
              <p className="text-sm text-destructive">
                {t("dropship.settings.lastError")}: {t(`dropship.error.${initial.lastError.split(" ")[0]}`)} {initial.lastError.split(" ")[1] ?? ""}
              </p>
            )}
          </div>

          <div className="grid h-fit gap-3">
            <span className="text-sm font-medium">{t("dropship.settings.rules")}</span>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5">
                <span className="text-sm">{t("dropship.settings.autoBelow")}</span>
                <Input inputMode="decimal" placeholder="0,00" value={v.autoBelow} onChange={(e) => set({ autoBelow: e.target.value })} disabled={disabled || !v.dropship} />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm">{t("dropship.settings.minMargin")}</span>
                <Input inputMode="decimal" value={v.minMargin} onChange={(e) => set({ minMargin: e.target.value })} disabled={disabled || !v.dropship} />
              </label>
            </div>
            {check("requirePaid", t("dropship.settings.requirePaid"))}
            {check("approveNewSupplier", t("dropship.settings.approveNew"))}
            {check("approvePriceChange", t("dropship.settings.approvePrice"))}
            {check("approveUnknownStock", t("dropship.settings.approveUnknownStock"))}

            {initial.dropship && initial.submitMethod === "API" && initial.callbackUrl && (
              <div className="grid gap-1.5 pt-2">
                <span className="text-sm font-medium">{t("dropship.settings.callback")}</span>
                <div className="flex gap-2">
                  <Input readOnly value={initial.callbackUrl} className="font-mono text-xs" />
                  <Button type="button" variant="outline" size="icon" aria-label={t("dropship.settings.copy")} onClick={() => copy(initial.callbackUrl!)}>
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            )}
            {initial.dropship && initial.submitMethod === "API" && initial.hasSecret && canManage && (
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">{t("dropship.settings.secret")}</span>
                {secret ? (
                  <div className="flex gap-2">
                    <Input readOnly value={secret} className="font-mono text-xs" />
                    <Button type="button" variant="outline" size="icon" aria-label={t("dropship.settings.copy")} onClick={() => copy(secret)}>
                      <Copy className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => showSecret(false)}>
                      <KeyRound className="size-4" /> {t("dropship.settings.showSecret")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setRenewing(true)}>
                      {t("dropship.settings.renewSecret")}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {canManage && (
            <div className="flex flex-wrap justify-end gap-2 lg:col-span-2">
              {initial.dropship && initial.submitMethod !== "MANUAL" && (
                <Button type="button" variant="outline" disabled={pending} onClick={test}>
                  {t("dropship.settings.test")}
                </Button>
              )}
              <Button type="submit" disabled={pending}>
                {t("common.save")}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
      <ConfirmDialog
        open={renewing}
        onOpenChange={setRenewing}
        title={t("dropship.settings.renewAsk")}
        text={t("dropship.settings.secret")}
        confirm={t("dropship.settings.renewSecret")}
        destructive
        onConfirm={() => {
          setRenewing(false);
          showSecret(true);
        }}
      />
    </Card>
  );
}
