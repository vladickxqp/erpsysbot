"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { saveClientAction, type ClientFormState } from "./actions";

export type ClientValues = {
  id?: string;
  type: "PERSON" | "COMPANY";
  status: "LEAD" | "ACTIVE" | "INACTIVE";
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  vatId?: string | null;
  notes?: string | null;
  tags?: string[];
  source?: string | null;
};

const EMPTY: ClientValues = { type: "PERSON", status: "ACTIVE", country: "DE" };

function Field({
  name,
  label,
  defaultValue,
  invalid,
  className,
  ...rest
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  invalid?: boolean;
  className?: string;
} & Omit<React.ComponentProps<typeof Input>, "defaultValue" | "name">) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={`f-${name}`}>{label}</Label>
      <Input id={`f-${name}`} name={name} defaultValue={defaultValue ?? ""} aria-invalid={invalid || undefined} {...rest} />
    </div>
  );
}

export function ClientDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ClientValues;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const values = initial ?? EMPTY;
  const [type, setType] = useState(values.type);
  const [status, setStatus] = useState(values.status);
  const [state, action, pending] = useActionState<ClientFormState, FormData>(saveClientAction, undefined);
  const [, startSubmit] = useTransition();
  const editing = Boolean(values.id);

  useEffect(() => {
    if (!state) return;
    if (state.ok && state.id) {
      toast.success(t("common.saved"));
      onOpenChange(false);
      if (!editing) router.push(`/app/clients/${state.id}`);
      else router.refresh();
    } else if (state.error === "forbidden") toast.error(t("common.forbidden"));
    else if (state.error === "notFound") toast.error(t("common.notFound"));
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const bad = (field: string) => state?.fields?.includes(field);
  const nameMissing = bad("lastName") && !bad("email");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? t("clients.editTitle") : t("clients.new")}</DialogTitle>
          <DialogDescription className="sr-only">{t("clients.details")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            // Sent by hand, not through the form's action: React would
            // otherwise empty every field after each answer, the typed
            // values included when the answer is "check this".
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            if (submitter?.dataset.force === "1") data.set("allowDuplicate", "1");
            startSubmit(() => action(data));
          }}
        >
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="status" value={status} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t("clients.type")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as ClientValues["type"])}>
                <SelectTrigger className="w-full" aria-label={t("clients.type")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERSON">{t("clients.person")}</SelectItem>
                  <SelectItem value="COMPANY">{t("clients.companyType")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("clients.status")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ClientValues["status"])}>
                <SelectTrigger className="w-full" aria-label={t("clients.status")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["ACTIVE", "LEAD", "INACTIVE"] as const).map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`clients.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {type === "COMPANY" && (
              <Field name="companyName" label={t("clients.companyName")} defaultValue={values.companyName} className="sm:col-span-2" invalid={nameMissing} autoFocus />
            )}
            <Field name="firstName" label={t("clients.firstName")} defaultValue={values.firstName} autoFocus={type === "PERSON"} />
            <Field name="lastName" label={t("clients.lastName")} defaultValue={values.lastName} invalid={nameMissing} />
            <Field name="email" type="email" label={t("clients.email")} defaultValue={values.email} invalid={bad("email")} />
            <Field name="phone" type="tel" label={t("clients.phone")} defaultValue={values.phone} />
          </div>
          {nameMissing && <p className="-mt-3 text-sm text-destructive">{t("clients.nameRequired")}</p>}
          {bad("email") && <p className="-mt-3 text-sm text-destructive">{t("clients.emailInvalid")}</p>}

          <div className="grid gap-3 sm:grid-cols-6">
            <Field name="street" label={t("clients.street")} defaultValue={values.street} className="sm:col-span-6" />
            <Field name="postalCode" label={t("clients.postalCode")} defaultValue={values.postalCode} className="sm:col-span-2" />
            <Field name="city" label={t("clients.city")} defaultValue={values.city} className="sm:col-span-3" />
            <Field name="country" label={t("clients.country")} defaultValue={values.country ?? "DE"} maxLength={2} className="sm:col-span-1" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="vatId" label={t("clients.vatId")} defaultValue={values.vatId} />
            <Field name="source" label={t("clients.source")} defaultValue={values.source} />
            <Field
              name="tags"
              label={t("clients.tags")}
              defaultValue={(values.tags ?? []).join(", ")}
              placeholder={t("clients.tagsHint")}
              className="sm:col-span-2"
            />
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="f-notes">{t("clients.notes")}</Label>
              <Textarea id="f-notes" name="notes" defaultValue={values.notes ?? ""} rows={3} />
            </div>
          </div>

          {state?.duplicates && state.duplicates.length > 0 && (
            <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-medium">{t("clients.duplicateTitle")}</p>
              <ul className="mt-2 grid gap-1">
                {state.duplicates.map((d) => (
                  <li key={d.id}>
                    <a className="text-primary hover:underline" href={`/app/clients/${d.id}`}>
                      #{d.number} {d.name}
                    </a>
                    <span className="text-muted-foreground"> {[d.email, d.phone].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            {state?.duplicates?.length ? (
              <Button type="submit" disabled={pending} data-force="1">
                {t("clients.createAnyway")}
              </Button>
            ) : (
              <Button type="submit" disabled={pending}>
                {pending ? t("common.loading") : t("common.save")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
