import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { currentContext, currentUser } from "@/server/request";
import { DEFAULT_REGION, LOCALE_COOKIE, MESSAGES, fromAcceptLanguage, isLocale, regionOf, translator, type Locale, type Region } from ".";

/** The signed-in person's language, else the cookie, else the browser's. */
export const getLocale = cache(async (): Promise<Locale> => {
  const user = await currentUser();
  if (user && isLocale(user.locale)) return user.locale;
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return fromAcceptLanguage((await headers()).get("accept-language"));
});

/** The active company's country and currency; Germany and euro before signing in. */
export const getRegion = cache(async (): Promise<Region> => {
  const ctx = await currentContext();
  return ctx ? regionOf(ctx.organization) : DEFAULT_REGION;
});

export async function getT() {
  const locale = await getLocale();
  return { locale, t: translator(MESSAGES[locale]), messages: MESSAGES[locale], region: await getRegion() };
}
