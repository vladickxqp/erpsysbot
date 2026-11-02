"use client";

import { Languages } from "lucide-react";
import { useTransition } from "react";
import { setLanguage } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/client";
import { LOCALES } from "@/i18n";

const NAMES = { de: "Deutsch", en: "English", ru: "Русский", uk: "Українська", kk: "Қазақша", es: "Español" } as const;

export function LocaleSwitch() {
  const { locale, t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("common.language")} disabled={pending}>
          <Languages className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((code) => (
          <DropdownMenuCheckboxItem
            key={code}
            checked={code === locale}
            onCheckedChange={() => start(() => setLanguage(code))}
          >
            {NAMES[code]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
