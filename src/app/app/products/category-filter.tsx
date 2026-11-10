"use client";

import { useListParams } from "@/components/app/list-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/client";

/** The category the list shows, kept in the address like search and status. */
export function CategoryFilter({ categories }: { categories: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const { params, go } = useListParams();
  return (
    <Select value={params.get("category") ?? "all"} onValueChange={(value) => go({ category: value === "all" ? null : value })}>
      <SelectTrigger className="w-full sm:w-56" aria-label={t("catalog.category")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("catalog.allCategories")}</SelectItem>
        {categories.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
