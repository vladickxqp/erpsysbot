"use client";

import { Copy, KeyRound, MoreHorizontal, Trash2, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { Role } from "@/server/permissions";
import { inviteAction, passwordLinkAction, removeAction, revokeAction, roleAction, type TeamResult } from "./actions";

const ROLES: Role[] = ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"];

type Member = { userId: string; name: string; email: string; role: string; since: string };
type Pending = { id: string; email: string; role: string; expiresAt: string };

function LinkBox({ url }: { url: string }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-2">
      <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t("team.copy")}
        onClick={() => navigator.clipboard.writeText(url).then(() => toast.success(t("team.copied")))}
      >
        <Copy className="size-4" />
      </Button>
    </div>
  );
}

export function TeamView({ me, myRole, canManage, members, pending }: { me: string; myRole: string; canManage: boolean; members: Member[]; pending: Pending[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("EMPLOYEE");
  const [link, setLink] = useState<{ title: string; url: string; mailed?: boolean } | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const roles = ROLES.filter((r) => r !== "OWNER" || myRole === "OWNER");
  const run = (work: () => Promise<TeamResult>, done?: (r: TeamResult) => void) =>
    start(async () => {
      const result = await work();
      if (result.error) toast.error(t(result.error));
      else {
        done?.(result);
        router.refresh();
      }
    });

  return (
    <div className="grid gap-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setInviting(true)}>
            <UserPlus className="size-4" /> {t("team.invite")}
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("team.name")}</TableHead>
              <TableHead>{t("settings.role")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("team.since")}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const editable = canManage && m.userId !== me && (m.role !== "OWNER" || myRole === "OWNER");
              return (
                <TableRow key={m.userId}>
                  <TableCell>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </TableCell>
                  <TableCell>
                    {editable ? (
                      <Select value={m.role} onValueChange={(r) => run(() => roleAction(m.userId, r as Role), () => toast.success(t("common.saved")))}>
                        <SelectTrigger className="w-40" aria-label={t("settings.role")} disabled={busy}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r} value={r}>
                              {t(`settings.${r}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary">{t(`settings.${m.role}`)}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(m.since, locale)}</TableCell>
                  <TableCell className="text-right">
                    {editable && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={t("nav.more")}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => run(() => passwordLinkAction(m.userId), (r) => r.url && setLink({ title: t("team.passwordLink"), url: r.url }))}
                          >
                            <KeyRound className="size-4" /> {t("team.passwordLink")}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setRemoving(m)}>
                            <Trash2 className="size-4" /> {t("team.remove")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("team.pending")}</CardTitle>
          </CardHeader>
          <CardContent className="grid divide-y p-0">
            {pending.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-6 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {t(`settings.${p.role}`)} · {t("team.until", { date: formatDate(p.expiresAt, locale) })}
                  </div>
                </div>
                <Button variant="ghost" size="icon" aria-label={t("team.revoke")} disabled={busy} onClick={() => run(() => revokeAction(p.id))}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={inviting}
        onOpenChange={(o) => {
          setInviting(o);
          if (!o) setEmail("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("team.invite")}</DialogTitle>
            <DialogDescription className="sr-only">{t("team.invite")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => inviteAction(email, role),
                (r) => {
                  setInviting(false);
                  setEmail("");
                  if (r.url) setLink({ title: t("team.inviteLink"), url: r.url, mailed: r.mailed });
                },
              );
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="invite-email">{t("auth.email")}</Label>
              <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("settings.role")}</Label>
              <Select value={role} onValueChange={(r) => setRole(r as Role)}>
                <SelectTrigger className="w-full" aria-label={t("settings.role")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`settings.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviting(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {t("team.invite")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={link !== null} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{link?.title}</DialogTitle>
            <DialogDescription>{link?.mailed ? t("team.mailed") : t("team.sendYourself")}</DialogDescription>
          </DialogHeader>
          {link && <LinkBox url={link.url} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("team.removeTitle")}
        text={t("team.removeText", { name: removing?.name ?? "" })}
        confirm={t("team.remove")}
        destructive
        onConfirm={() => {
          const m = removing;
          setRemoving(null);
          if (m) run(() => removeAction(m.userId));
        }}
      />
    </div>
  );
}
