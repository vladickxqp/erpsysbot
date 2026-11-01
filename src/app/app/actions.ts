"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { LOCALE_COOKIE, isLocale } from "@/i18n";
import { membershipOf } from "@/server/accounts";
import { setActiveOrganization } from "@/server/auth/sessions";
import { currentUser } from "@/server/request";

export async function setLanguage(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const user = await currentUser();
  if (user) await getDb().update(users).set({ locale }).where(eq(users.id, user.userId));
  revalidatePath("/", "layout");
}

/** Switch to another company — only one the person is a member of. */
export async function switchCompany(organizationId: string): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  if (!(await membershipOf(user.userId, organizationId))) return;
  await setActiveOrganization(user.sessionId, organizationId);
  revalidatePath("/app", "layout");
}
