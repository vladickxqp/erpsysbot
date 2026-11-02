"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { updateCompany, type CompanyInput } from "@/server/company";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { botUsername } from "@/server/telegram/api";
import { createLinkToken, setNotify, unlink } from "@/server/telegram/links";

export type CompanyResult = { ok?: boolean; error?: "forbidden" | "check"; fields?: string[] };

export async function saveCompanyAction(input: CompanyInput): Promise<CompanyResult> {
  const ctx = await requireContext();
  try {
    await updateCompany(ctx, input);
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    if (e instanceof ZodError) return { error: "check", fields: e.issues.map((i) => String(i.path[0])) };
    throw e;
  }
}

export async function connectTelegramAction(): Promise<{ url?: string; error?: "notSet" }> {
  const ctx = await requireContext();
  const bot = await botUsername();
  if (!bot) return { error: "notSet" };
  const token = await createLinkToken(ctx.user.userId, ctx.organization.id);
  return { url: `https://t.me/${bot}?start=${token}` };
}

export async function disconnectTelegramAction(): Promise<void> {
  const ctx = await requireContext();
  await unlink(ctx.user.userId);
  revalidatePath("/app/settings");
}

export async function telegramNotifyAction(notify: boolean): Promise<void> {
  const ctx = await requireContext();
  await setNotify(ctx.user.userId, notify);
  revalidatePath("/app/settings");
}
