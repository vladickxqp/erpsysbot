"use client";

import { Building2, Check, Copy, Pause, Play, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { AREAS, isArea } from "@/lib/areas";
import { companyCountryAction, companyPlanAction, inviteCompanyAction, planAction, suspendAction } from "./actions";

type Company = {
  id: string;
  name: string;
  createdAt: string;
  country: string;
  signupIpCountry: string | null;
  members: number;
  lastActivity: string | null;
  planId: string | null;
  status: string | null;
  suspended: boolean;
  review: boolean;
  mine: boolean;
};
type Plan = { id: string; name: string; priceCents: number; maxUsers: number; aiPerDay: number; modules: string[]; areas: string[]; stripePriceId: string | null; active: boolean };

export function AdminView({
  billing,
  modules,
  companies,
  plans,
  invites,
  countries,
}: {
  countries: { code: string; name: string }[];
  billing: boolean;
  modules: string[];
  companies: Company[];
  plans: Plan[];
  invites: { id: string; email: string; expiresAt: string }[];
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, Plan>>({});
  const [countryOf, setCountryOf] = useState<string | null>(null);
  const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;

  const run = (work: () => Promise<{ ok?: boolean; error?: string; url?: string }>, done?: (r: { url?: string }) => void) =>
    start(async () => {
      const result = await work();
      if (result.ok) {
        done?.(result);
        router.refresh();
      } else toast.error(t(result.error ?? "common.error"));
    });

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("admin.inviteCompany")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => inviteCompanyAction(email), (r) => {
                setLink(r.url ?? null);
                setEmail("");
              });
            }}
          >
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.email")} required className="max-w-sm" />
            <Button type="submit" disabled={pending}>
              {t("team.invite")}
            </Button>
          </form>
          {link && (
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button variant="outline" size="icon" aria-label={t("team.copy")} onClick={() => navigator.clipboard.writeText(link).then(() => toast.success(t("team.copied")))}>
                <Copy className="size-4" />
              </Button>
            </div>
          )}
          {invites.length > 0 && (
            <div className="text-sm text-muted-foreground">
              {t("team.pending")}: {invites.map((i) => `${i.email} (${formatDate(i.expiresAt, locale, region)})`).join(", ")}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.company")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("admin.users")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("admin.lastActivity")}</TableHead>
              <TableHead>{t("billing.plan")}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.map((c) => (
              <TableRow key={c.id} className={c.suspended ? "opacity-60" : undefined}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    <Building2 className="size-4 text-muted-foreground" /> {c.name}
                    {c.review ? <Badge variant="destructive">{t("admin.review")}</Badge> : c.suspended && <Badge variant="destructive">{t("admin.suspended")}</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {formatDate(c.createdAt, locale, region)} ·
                    {countryOf === c.id ? (
                      <select
                        className="rounded border bg-background px-1 py-0.5 text-xs"
                        defaultValue={c.country}
                        autoFocus
                        aria-label={t("company.country")}
                        onBlur={() => setCountryOf(null)}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCountryOf(null);
                          run(() => companyCountryAction(c.id, value));
                        }}
                      >
                        {countries.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <button type="button" className="hover:underline" title={t("company.country")} onClick={() => setCountryOf(c.id)}>
                        {countryName(c.country)}
                      </button>
                    )}
                    {c.signupIpCountry && c.signupIpCountry !== c.country && (
                      <span className="inline-flex items-center gap-1 text-destructive" title={t("admin.ipCountry")}>
                        <TriangleAlert className="size-3" /> IP: {c.signupIpCountry}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">{c.members}</TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{c.lastActivity ? formatDate(c.lastActivity, locale, region) : "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={c.planId ?? "-"} onValueChange={(v) => run(() => companyPlanAction(c.id, v, "ACTIVE"))}>
                      <SelectTrigger className="h-8 w-36" aria-label={t("billing.plan")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="-" disabled>
                          —
                        </SelectItem>
                        {plans.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {billing && c.status && <Badge variant="secondary">{t(`billing.${c.status}`)}</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  {!c.mine && (
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={pending}
                      aria-label={c.review ? t("admin.approve") : c.suspended ? t("admin.resume") : t("admin.suspend")}
                      title={c.review ? t("admin.approve") : undefined}
                      onClick={() => run(() => suspendAction(c.id, !c.suspended))}
                    >
                      {c.review ? <Check className="size-4" /> : c.suspended ? <Play className="size-4" /> : <Pause className="size-4" />}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const draft = editing[p.id] ?? p;
          const set = (patch: Partial<Plan>) => setEditing({ ...editing, [p.id]: { ...draft, ...patch } });
          return (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle className="text-base">{p.name}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <label className="grid gap-1">
                  {t("admin.price")}
                  <Input type="number" min={0} value={draft.priceCents / 100} onChange={(e) => set({ priceCents: Math.round(Number(e.target.value) * 100) })} />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1">
                    {t("admin.users")}
                    <Input type="number" min={1} value={draft.maxUsers} onChange={(e) => set({ maxUsers: Number(e.target.value) })} />
                  </label>
                  <label className="grid gap-1">
                    {t("admin.aiPerDay")}
                    <Input type="number" min={0} value={draft.aiPerDay} onChange={(e) => set({ aiPerDay: Number(e.target.value) })} />
                  </label>
                </div>
                <label className="grid gap-1">
                  Stripe Price ID
                  <Input value={draft.stripePriceId ?? ""} onChange={(e) => set({ stripePriceId: e.target.value || null })} placeholder="price_…" />
                </label>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {AREAS.map((a) => (
                    <label key={a} className="flex items-center gap-2">
                      <Checkbox
                        checked={draft.areas.includes(a)}
                        onCheckedChange={(c) => set({ areas: c === true ? [...draft.areas, a] : draft.areas.filter((x) => x !== a) })}
                      />
                      {t(`areas.${a}`)}
                    </label>
                  ))}
                  <label className="flex items-center gap-2">
                    <Checkbox checked={draft.active} onCheckedChange={(c) => set({ active: c === true })} />
                    {t("areas.planActive")}
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {modules.map((m) => (
                    <label key={m} className="flex items-center gap-2">
                      <Checkbox
                        checked={draft.modules.includes(m)}
                        onCheckedChange={(c) => set({ modules: c === true ? [...draft.modules, m] : draft.modules.filter((x) => x !== m) })}
                      />
                      {t(`billing.module_${m}`)}
                    </label>
                  ))}
                </div>
                {editing[p.id] && (
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => planAction(p.id, { name: draft.name, priceCents: draft.priceCents, maxUsers: draft.maxUsers, aiPerDay: draft.aiPerDay, modules: draft.modules, areas: draft.areas.filter(isArea), stripePriceId: draft.stripePriceId, active: draft.active }),
                        () => {
                          const next = { ...editing };
                          delete next[p.id];
                          setEditing(next);
                          toast.success(t("common.saved"));
                        },
                      )
                    }
                  >
                    {t("common.save")}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
