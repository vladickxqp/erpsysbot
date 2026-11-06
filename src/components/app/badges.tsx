"use client";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

const ORDER: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  NEW: "bg-primary/10 text-primary border-primary/20",
  CONFIRMED: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border-indigo-500/20",
  IN_PROGRESS: "bg-warning/10 text-warning border-warning/30",
  WAITING: "bg-warning/10 text-warning border-warning/30",
  COMPLETED: "bg-success/10 text-success border-success/20",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

const INVOICE: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  ISSUED: "bg-primary/10 text-primary border-primary/20",
  SENT: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",
  PARTIALLY_PAID: "bg-warning/10 text-warning border-warning/30",
  PAID: "bg-success/10 text-success border-success/20",
  CANCELLED: "bg-muted text-muted-foreground",
  CREDITED: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border-indigo-500/20",
  OVERDUE: "bg-destructive/10 text-destructive border-destructive/20",
};

export function OrderStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", ORDER[status])}>
      {t(`orders.${status}`)}
    </Badge>
  );
}

export function InvoiceStatusBadge({ status, overdue, kind, sent }: { status: string; overdue?: boolean; kind?: string; sent?: boolean }) {
  const { t } = useI18n();
  if (kind === "CREDIT_NOTE") {
    return (
      <Badge variant="outline" className="whitespace-nowrap bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
        {t("invoices.creditNote")}
      </Badge>
    );
  }
  const key = overdue ? "OVERDUE" : status === "ISSUED" && sent ? "SENT" : status;
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", INVOICE[key])}>
      {t(key === "SENT" || key === "CREDITED" ? `invoicing.status_${key}` : `invoices.${key}`)}
    </Badge>
  );
}

const QUOTE: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SENT: "bg-primary/10 text-primary border-primary/20",
  ACCEPTED: "bg-success/10 text-success border-success/20",
  DECLINED: "bg-muted text-muted-foreground line-through",
  EXPIRED: "bg-warning/10 text-warning border-warning/30",
};

export function QuoteStatusBadge({ status, expired }: { status: string; expired?: boolean }) {
  const { t } = useI18n();
  const key = expired ? "EXPIRED" : status;
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", QUOTE[key])}>
      {t(`quotes.${key}`)}
    </Badge>
  );
}

export const CONTENT_STATUS_CLASS: Record<string, string> = {
  IDEA: "bg-muted text-muted-foreground",
  DRAFT: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border-indigo-500/20",
  REVIEW: "bg-warning/10 text-warning border-warning/30",
  SCHEDULED: "bg-primary/10 text-primary border-primary/20",
  PUBLISHED: "bg-success/10 text-success border-success/20",
};

export function ContentStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", CONTENT_STATUS_CLASS[status])}>
      {t(`studio.status.${status}`)}
    </Badge>
  );
}
