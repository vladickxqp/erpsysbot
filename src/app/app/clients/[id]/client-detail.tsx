"use client";

import { Archive, ArchiveRestore, ArrowLeft, Mail, MapPin, Pencil, Phone, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/client";
import { archiveClientAction, deleteClientAction } from "../actions";
import { ClientDialog, type ClientValues } from "../client-form";
import { StatusBadge } from "../clients-view";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function ClientDetail({
  client,
  name,
  created,
  canEdit,
  canDelete,
}: {
  client: ClientValues & { id: string; number: number; archived: boolean };
  name: string;
  created: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const address = [client.street, [client.postalCode, client.city].filter(Boolean).join(" "), client.country]
    .filter(Boolean)
    .join(", ");

  const remove = () =>
    start(async () => {
      const result = await deleteClientAction(client.id);
      if (result?.ok) {
        toast.success(t("common.deleted"));
        router.push("/app/clients");
      } else toast.error(t(result?.error === "forbidden" ? "common.forbidden" : "common.error"));
    });

  return (
    <>
      <div className="mb-6">
        <Link href="/app/clients" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {t("clients.title")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
              <StatusBadge status={client.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              #{client.number} · {t(client.type === "COMPANY" ? "clients.companyType" : "clients.person")} · {t("clients.created")} {created}
            </p>
          </div>
          <div className="flex gap-2">
            {canEdit && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> {t("common.edit")}
              </Button>
            )}
            {canEdit && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await archiveClientAction(client.id, !client.archived);
                    if (result.error) toast.error(t("common.error"));
                    router.refresh();
                  })
                }
              >
                {client.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                <span className="sr-only sm:not-sr-only">{t(client.archived ? "crm.unarchive" : "crm.archive")}</span>
              </Button>
            )}
            {canDelete && (
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
                <Trash2 className="size-4" /> <span className="sr-only sm:not-sr-only">{t("common.delete")}</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("clients.contact")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              {client.email && (
                <Row label={t("clients.email")}>
                  <a href={`mailto:${client.email}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                    <Mail className="size-3.5" /> {client.email}
                  </a>
                </Row>
              )}
              {client.phone && (
                <Row label={t("clients.phone")}>
                  <a href={`tel:${client.phone}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                    <Phone className="size-3.5" /> {client.phone}
                  </a>
                </Row>
              )}
              {address && (
                <Row label={t("clients.address")}>
                  <span className="inline-flex items-start gap-1.5">
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> {address}
                  </span>
                </Row>
              )}
              {client.website && (
                <Row label={t("crm.website")}>
                  <a href={/^https?:\/\//.test(client.website) ? client.website : `https://${client.website}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {client.website}
                  </a>
                </Row>
              )}
              {client.industry && <Row label={t("crm.industry")}>{client.industry}</Row>}
              {client.vatId && <Row label={t("clients.vatId")}>{client.vatId}</Row>}
              {client.source && <Row label={t("clients.source")}>{client.source}</Row>}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("clients.details")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            {client.tags && client.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {client.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            {client.notes ? (
              <p className="whitespace-pre-wrap">{client.notes}</p>
            ) : (
              <p className="text-muted-foreground">{t("clients.notes")}: —</p>
            )}
          </CardContent>
        </Card>
      </div>

      {editing && <ClientDialog open onOpenChange={setEditing} initial={client} />}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clients.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("clients.deleteText", { name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={pending} className="bg-destructive text-white hover:bg-destructive/90">
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
