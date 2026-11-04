"use client";

import { Calendar, FileSignature, FileText, FolderOpen, KanbanSquare, ListTodo, Mail, MessageSquare, Phone, Plus, ShoppingCart, Trash2, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { intlTag } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { TimelineEntry } from "@/server/client-history";
import { addActivityAction, deleteActivityAction, deleteContactAction, saveContactAction, type ClientResult } from "../actions";

type Contact = { id: string; name: string; role: string | null; email: string | null; phone: string | null };

const ICONS: Record<string, LucideIcon> = {
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Users,
  NOTE: MessageSquare,
  INVOICE: FileText,
  ORDER: ShoppingCart,
  QUOTE: FileSignature,
  APPOINTMENT: Calendar,
  TASK: ListTodo,
  DEAL: KanbanSquare,
  DOCUMENT: FolderOpen,
};
const KINDS = ["CALL", "EMAIL", "MEETING", "NOTE"] as const;

export function ClientCrm({ clientId, contacts, timeline, me, canEdit }: { clientId: string; contacts: Contact[]; timeline: TimelineEntry[]; me: string; canEdit: boolean }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [contact, setContact] = useState({ name: "", role: "", email: "", phone: "" });
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("CALL");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const when = (iso: string) => new Intl.DateTimeFormat(intlTag(locale, region), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const run = (work: () => Promise<ClientResult>, then?: () => void) =>
    start(async () => {
      const res = await work();
      if (res.error) toast.error(t(res.error === "forbidden" ? "common.forbidden" : "auth.check"));
      else then?.();
      router.refresh();
    });

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card className="h-fit">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t("crm.contacts")}</CardTitle>
          {canEdit && (
            <Button size="icon" variant="ghost" className="size-7" onClick={() => setAdding((v) => !v)} aria-label={t("crm.addContact")}>
              <Plus className="size-4" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {contacts.length === 0 && !adding && <p className="text-muted-foreground">{t("common.none")}</p>}
          {contacts.map((c) => (
            <div key={c.id} className="flex items-start gap-2 rounded-lg border p-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.name}</div>
                {c.role && <div className="text-xs text-muted-foreground">{c.role}</div>}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="block truncate text-xs text-primary hover:underline">
                    {c.email}
                  </a>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="block text-xs text-primary hover:underline">
                    {c.phone}
                  </a>
                )}
              </div>
              {canEdit && (
                <Button size="icon" variant="ghost" className="size-7" disabled={pending} onClick={() => run(() => deleteContactAction(c.id))} aria-label={t("common.delete")}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
          {adding && (
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => saveContactAction(clientId, null, contact),
                  () => {
                    setContact({ name: "", role: "", email: "", phone: "" });
                    setAdding(false);
                  },
                );
              }}
            >
              <Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} placeholder={t("crm.name")} aria-label={t("crm.name")} required maxLength={160} autoFocus />
              <Input value={contact.role} onChange={(e) => setContact({ ...contact, role: e.target.value })} placeholder={t("crm.role")} aria-label={t("crm.role")} maxLength={100} />
              <Input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder={t("auth.email")} aria-label={t("auth.email")} />
              <Input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder={t("crm.phone")} aria-label={t("crm.phone")} maxLength={40} />
              <Button type="submit" size="sm" disabled={pending}>
                {t("common.save")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">{t("crm.timeline")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {canEdit && (
            <form
              className="grid gap-2 rounded-lg border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => addActivityAction(clientId, { kind, subject, body }),
                  () => {
                    setSubject("");
                    setBody("");
                  },
                );
              }}
            >
              <div className="flex flex-wrap gap-2">
                <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                  <SelectTrigger className="w-36" aria-label={t("crm.kindLabel")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`crm.kind.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input className="min-w-40 flex-1" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("crm.subject")} aria-label={t("crm.subject")} maxLength={300} required />
              </div>
              <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("crm.details")} aria-label={t("crm.details")} />
              <div>
                <Button type="submit" size="sm" disabled={pending || !subject.trim()}>
                  {t("crm.add")}
                </Button>
              </div>
            </form>
          )}
          {timeline.length === 0 ? (
            <p className="text-muted-foreground">{t("crm.noHistory")}</p>
          ) : (
            <div className="grid divide-y">
              {timeline.map((e) => {
                const Icon = ICONS[e.kind] ?? MessageSquare;
                const title = (
                  <>
                    <span className="text-muted-foreground">{t(`crm.kind.${e.kind}`)}:</span> {e.title}
                  </>
                );
                return (
                  <div key={e.key} className="flex items-start gap-3 py-2.5">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        {e.href ? (
                          <Link href={e.href} className="hover:text-primary hover:underline">
                            {title}
                          </Link>
                        ) : (
                          title
                        )}
                      </div>
                      {e.body && <p className="whitespace-pre-line text-xs text-muted-foreground">{e.body}</p>}
                      <div className="text-xs text-muted-foreground">{when(e.at)}</div>
                    </div>
                    {e.activityId && e.userId === me && canEdit && (
                      <Button size="icon" variant="ghost" className="size-7" disabled={pending} onClick={() => run(() => deleteActivityAction(e.activityId!))} aria-label={t("common.delete")}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
