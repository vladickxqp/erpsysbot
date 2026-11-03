"use client";

import { Download, Trash2, UserX } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/client";
import { deleteAccountAction, deleteCompanyAction } from "./actions";

/** Take one's data along, or delete it (DSGVO/GDPR). */
export function PrivacyCard({ owner, companyName }: { owner: boolean; companyName: string }) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState<"company" | "account" | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const close = () => {
    setDeleting(null);
    setName("");
    setPassword("");
  };

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="text-base">{t("privacy.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Button asChild variant="outline" className="justify-start">
          <a href="/app/settings/export/me">
            <Download className="size-4" /> {t("privacy.exportMe")}
          </a>
        </Button>
        {owner && (
          <Button asChild variant="outline" className="justify-start">
            <a href="/app/settings/export/company">
              <Download className="size-4" /> {t("privacy.exportCompany")}
            </a>
          </Button>
        )}
        {owner && (
          <Button variant="outline" className="justify-start text-destructive" onClick={() => setDeleting("company")}>
            <Trash2 className="size-4" /> {t("privacy.deleteCompany")}
          </Button>
        )}
        <Button variant="outline" className="justify-start text-destructive" onClick={() => setDeleting("account")}>
          <UserX className="size-4" /> {t("privacy.deleteAccount")}
        </Button>
      </CardContent>

      <Dialog open={!!deleting} onOpenChange={(v) => !v && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{deleting === "company" ? t("privacy.deleteCompany") : t("privacy.deleteAccount")}</DialogTitle>
            <DialogDescription>{deleting === "company" ? t("privacy.companyWarning") : t("privacy.accountWarning")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = deleting === "company" ? await deleteCompanyAction(name, password) : await deleteAccountAction(password);
                if (res?.error) toast.error(t(res.error));
              });
            }}
          >
            {deleting === "company" && (
              <div className="grid gap-1.5">
                <Label htmlFor="del-name">{t("privacy.typeName", { name: companyName })}</Label>
                <Input id="del-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="del-password">{t("auth.password")}</Label>
              <Input id="del-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={pending || !password || (deleting === "company" && name.trim() !== companyName.trim())}>
                {t("common.delete")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
