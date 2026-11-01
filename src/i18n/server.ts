import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { currentUser } from "@/server/request";
import { LOCALE_COOKIE, MESSAGES, fromAcceptLanguage, isLocale, translator, type Locale } from ".";

/** The signed-in person's language, else the cookie, else the browser's. */
export const getLocale = cache(async (): Promise<Locale> => {
  const user = await currentUser();
  if (user && isLocale(user.locale)) return user.locale;
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return fromAcceptLanguage((await headers()).get("accept-language"));
});

export async function getT() {
  const locale = await getLocale();
  return { locale, t: translator(MESSAGES[locale]), messages: MESSAGES[locale] };
}
