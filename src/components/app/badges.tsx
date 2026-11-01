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
  PARTIALLY_PAID: "bg-warning/10 text-warning border-warning/30",
  PAID: "bg-success/10 text-success border-success/20",
  CANCELLED: "bg-muted text-muted-foreground",
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

export function InvoiceStatusBadge({ status, overdue, kind }: { status: string; overdue?: boolean; kind?: string }) {
  const { t } = useI18n();
  if (kind === "CREDIT_NOTE") {
    return (
      <Badge variant="outline" className="whitespace-nowrap bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
        {t("invoices.creditNote")}
      </Badge>
    );
  }
  const key = overdue ? "OVERDUE" : status;
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", INVOICE[key])}>
      {t(`invoices.${key}`)}
    </Badge>
  );
}
