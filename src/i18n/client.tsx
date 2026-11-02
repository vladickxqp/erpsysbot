"use client";

import { createContext, useContext, useMemo } from "react";
import { translator, type Locale, type Messages, type Region, type T } from ".";

const I18n = createContext<{ locale: Locale; region: Region; t: T } | null>(null);

export function I18nProvider({
  locale,
  region,
  messages,
  children,
}: {
  locale: Locale;
  region: Region;
  messages: Messages;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ locale, region, t: translator(messages) }), [locale, region, messages]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useI18n() {
  const value = useContext(I18n);
  if (!value) throw new Error("useI18n outside I18nProvider");
  return value;
}
