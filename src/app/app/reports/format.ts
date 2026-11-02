import { formatDate, formatMoney, intlTag, type Locale, type Region } from "@/i18n";
import type { Column } from "@/server/reports";

/** One report cell as text in the user's language (shared by the page and the PDF). */
export function formatCell(column: Column, value: string | number | null | undefined, locale: Locale, region: Region, t: (key: string) => string): string {
  if (value == null || value === "") return "—";
  switch (column.kind) {
    case "money":
      return formatMoney(Number(value), locale, region);
    case "number":
      return new Intl.NumberFormat(intlTag(locale, region), { maximumFractionDigits: 3 }).format(Number(value));
    case "percent":
      return new Intl.NumberFormat(intlTag(locale, region), { style: "percent", maximumFractionDigits: 1 }).format(Number(value));
    case "date":
      return formatDate(String(value), locale, region);
    default:
      return typeof value === "string" && /^[a-z]+\.[A-Za-z0-9_]+$/.test(value) ? t(value) : String(value);
  }
}
