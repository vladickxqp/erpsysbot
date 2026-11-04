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
import { deleteDepartmentAction, permissionsAction, saveDepartmentAction } from "./actions";

export type Department = { id: string; name: string };

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

/** Rights by area; the action words are few, so "clients.read" reads as area + word. */
export function PermissionsDialog({ member, all, mine, onClose }: { member: { userId: string; name: string; permissions: string[] }; all: readonly string[]; mine: string[]; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [chosen, setChosen] = useState(new Set(member.permissions));
  const [pending, start] = useTransition();
  const areas = [...new Set(all.map((p) => p.split(".")[0]))];
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("permissions.title", { name: member.name })}</DialogTitle>
          <DialogDescription className="sr-only">{t("permissions.title", { name: member.name })}</DialogDescription>
        </DialogHeader>
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
