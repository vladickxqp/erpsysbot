"use client";

import { useListParams } from "@/components/app/list-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/client";

type Option = { value: string; label: string };

export function AuditFilters({ entities, members }: { entities: Option[]; members: Option[] }) {
  const { t } = useI18n();
  const { params, go } = useListParams();
  const pick = (name: string, label: string, options: Option[]) => (
    <Select value={params.get(name) ?? "ALL"} onValueChange={(v) => go({ [name]: v === "ALL" ? null : v })}>
      <SelectTrigger className="w-full sm:w-52" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">{label}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {pick("entity", t("audit.allAreas"), entities)}
      {pick("user", t("audit.allPeople"), members)}
    </div>
  );
}
