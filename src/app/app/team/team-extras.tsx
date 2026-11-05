"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignUnitAction, deleteCustomRoleAction, deleteDepartmentAction, deleteUnitAction, permissionsAction, saveCustomRoleAction, saveDepartmentAction, saveUnitAction } from "./actions";

export type Department = { id: string; name: string; unitId: string | null };
export type CustomRole = { id: string; name: string; permissions: string[] };

export function DepartmentsCard({ departments, members }: { departments: Department[]; members: { departmentId: string | null }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("departments.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {departments.map((d) => (
          <div key={d.id} className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{members.filter((m) => m.departmentId === d.id).length}</span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={pending}
              aria-label={t("common.delete")}
              onClick={() =>
                start(async () => {
                  const res = await deleteDepartmentAction(d.id);
                  if (res.error) toast.error(t(res.error));
                  router.refresh();
                })
              }
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await saveDepartmentAction(name);
              if (res.error) toast.error(t(res.error));
              else setName("");
              router.refresh();
            });
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("departments.new")} aria-label={t("departments.new")} required maxLength={120} />
          <Button type="submit" size="icon" variant="outline" disabled={pending} aria-label={t("crm.add")}>
            <Plus className="size-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Parts of a larger company: each groups departments. */
export function UnitsCard({ units, departments }: { units: { id: string; name: string }[]; departments: Department[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const run = (work: () => Promise<{ error?: string }>, then?: () => void) =>
    start(async () => {
      const res = await work();
      if (res.error) toast.error(t(res.error));
      else then?.();
      router.refresh();
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("hub.team.units")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {units.map((u) => (
          <div key={u.id} className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate">{u.name}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{departments.filter((d) => d.unitId === u.id).length}</span>
            <Button size="icon" variant="ghost" className="size-7" disabled={pending} aria-label={t("common.delete")} onClick={() => run(() => deleteUnitAction(u.id))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {units.length > 0 &&
          departments.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.name}</span>
              <Select value={d.unitId ?? "-"} onValueChange={(v) => run(() => assignUnitAction(d.id, v === "-" ? null : v))}>
                <SelectTrigger className="w-44" aria-label={t("hub.team.units")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="-">—</SelectItem>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveUnitAction(name), () => setName(""));
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("hub.team.newUnit")} aria-label={t("hub.team.newUnit")} required maxLength={120} />
          <Button type="submit" size="icon" variant="outline" disabled={pending} aria-label={t("crm.add")}>
            <Plus className="size-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RightsGrid({ all, mine, chosen, setChosen }: { all: readonly string[]; mine: string[]; chosen: Set<string>; setChosen: (update: (s: Set<string>) => Set<string>) => void }) {
  const { t } = useI18n();
  const areas = [...new Set(all.map((p) => p.split(".")[0]))];
  return (
    <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">
      {areas.map((area) => (
        <div key={area} className="grid gap-1">
          <div className="text-sm font-medium">{t(`permissions.area.${area}`)}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {all
              .filter((p) => p.startsWith(`${area}.`))
              .map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={chosen.has(p)}
                    disabled={!mine.includes(p)}
                    onCheckedChange={(v) =>
                      setChosen((s) => {
                        const next = new Set(s);
                        if (v === true) next.add(p);
                        else next.delete(p);
                        return next;
                      })
                    }
                  />
                  {t(`permissions.action.${p.split(".")[1]}`)}
                </label>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Roles with a name: a set of rights to hand to several people at once. */
export function CustomRolesCard({ roles, members, all, mine }: { roles: CustomRole[]; members: { customRoleId: string | null }[]; all: readonly string[]; mine: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<CustomRole | null>(null);
  const [chosen, setChosen] = useState(new Set<string>());
  const [pending, start] = useTransition();
  const open = (role: CustomRole) => {
    setEditing(role);
    setChosen(new Set(role.permissions));
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t("hub.roles.title")}</CardTitle>
        <Button size="sm" variant="outline" onClick={() => open({ id: "", name: "", permissions: [] })}>
          <Plus className="size-4" /> {t("hub.roles.new")}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {roles.length === 0 && <p className="text-muted-foreground">{t("hub.roles.empty")}</p>}
        {roles.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
            <button type="button" className="min-w-0 flex-1 truncate text-left font-medium" onClick={() => open(r)}>
              {r.name}
            </button>
            <span className="text-xs text-muted-foreground">{t("hub.roles.people", { count: members.filter((m) => m.customRoleId === r.id).length })}</span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={pending}
              aria-label={t("common.delete")}
              onClick={() =>
                start(async () => {
                  const res = await deleteCustomRoleAction(r.id);
                  if (res.error) toast.error(t(res.error));
                  router.refresh();
                })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </CardContent>
      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? editing.name : t("hub.roles.new")}</DialogTitle>
            <DialogDescription className="sr-only">{t("hub.roles.title")}</DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const res = await saveCustomRoleAction(editing.id || null, editing.name, [...chosen]);
                  if (res.error) toast.error(t(res.error));
                  else {
                    setEditing(null);
                    router.refresh();
                  }
                });
              }}
            >
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder={t("hub.roles.name")} aria-label={t("hub.roles.name")} required maxLength={60} autoFocus />
              <RightsGrid all={all} mine={mine} chosen={chosen} setChosen={setChosen} />
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Rights by area; the action words are few, so "clients.read" reads as area + word. */
export function PermissionsDialog({ member, all, mine, onClose }: { member: { userId: string; name: string; permissions: string[] }; all: readonly string[]; mine: string[]; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [chosen, setChosen] = useState(new Set(member.permissions));
  const [pending, start] = useTransition();
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("permissions.title", { name: member.name })}</DialogTitle>
          <DialogDescription className="sr-only">{t("permissions.title", { name: member.name })}</DialogDescription>
        </DialogHeader>
        <RightsGrid all={all} mine={mine} chosen={chosen} setChosen={setChosen} />
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await permissionsAction(member.userId, [...chosen]);
                if (res.error) toast.error(t(res.error));
                else {
                  toast.success(t("common.saved"));
                  onClose();
                  router.refresh();
                }
              })
            }
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
