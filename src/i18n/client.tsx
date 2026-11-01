"use client";

import { createContext, useContext, useMemo } from "react";
import { translator, type Locale, type Messages, type T } from ".";

const I18n = createContext<{ locale: Locale; t: T } | null>(null);

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ locale, t: translator(messages) }), [locale, messages]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useI18n() {
  const value = useContext(I18n);
  if (!value) throw new Error("useI18n outside I18nProvider");
  return value;
}
