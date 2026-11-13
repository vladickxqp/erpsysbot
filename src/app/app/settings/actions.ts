"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { ZodError } from "zod";
import {
  confirmSetup,
  disableTwoFactor,
  endOtherSessions,
  endSession,
  newRecoveryCodesFor,
  startSetup,
  TwoFactorError,
} from "@/server/auth/two-factor";
import { withTenant } from "@/db/tenant";
import { changePassword, PasswordChangeError, passwordMatches } from "@/server/accounts";
import { audit } from "@/server/audit";
import { isLocale } from "@/i18n";
import { sendVerificationMail } from "@/server/auth/email-verification";
import { SESSION_COOKIE } from "@/server/auth/sessions";
import { newCalendarLink } from "@/server/calendar-feed";
import { setCompanyLogo, updateCompany, type CompanyInput } from "@/server/company";
import { deleteInvoiceTemplate, saveInvoiceTemplate, TemplateError, type TemplateInput } from "@/server/invoice-templates";
import { takeMailThrottle } from "@/server/mail";
import { deleteAccount, deleteCompany, PrivacyError } from "@/server/privacy";
import { AreaError, setCompanyAreas } from "@/server/areas";
import { setCompanyModules, setMyModules } from "@/server/modules";
import { ForbiddenError } from "@/server/permissions";
import { publicBase, requireContext } from "@/server/request";
import { botUsername } from "@/server/telegram/api";
import { createLinkToken, setNotify, unlink } from "@/server/telegram/links";

export type CompanyResult = { ok?: boolean; error?: "forbidden" | "check"; fields?: string[] };

export type TemplateResult = { ok?: boolean; error?: "forbidden" | "check" | TemplateError["code"] };

export async function saveTemplateAction(id: string | null, input: TemplateInput): Promise<TemplateResult> {
  const ctx = await requireContext();
  try {
    await saveInvoiceTemplate(ctx, id, input);
    revalidatePath("/app/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    if (e instanceof TemplateError) return { error: e.code };
    if (e instanceof ZodError) return { error: "check" };
    throw e;
  }
}

export async function deleteTemplateAction(id: string): Promise<TemplateResult> {
  const ctx = await requireContext();
  try {
    await deleteInvoiceTemplate(ctx, id);
    revalidatePath("/app/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    throw e;
  }
}

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

export async function saveModulesAction(scope: "company" | "me", off: string[]): Promise<{ ok?: boolean; error?: "forbidden" }> {
  const ctx = await requireContext();
  try {
    if (scope === "company") await setCompanyModules(ctx, off);
    else await setMyModules(ctx, off);
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    throw e;
  }
}

export type SecurityResult = { ok?: boolean; error?: string; secret?: string; qr?: string; codes?: string[] };

function securityFailure(e: unknown): SecurityResult {
  if (e instanceof TwoFactorError) return { error: e.code === "INVALID_CODE" ? "auth.code_wrong" : "common.error" };
  throw e;
}

/** Switching on needs the password: a session left open is not enough to lock its owner out. */
export async function startTwoFactorAction(password: string): Promise<SecurityResult> {
  const ctx = await requireContext();
  try {
    if (!(await passwordMatches(ctx.user.userId, password))) return { error: "privacy.WRONG_PASSWORD" };
    const { secret, uri } = await startSetup(ctx.user.userId, ctx.user.email);
    const qr = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return { secret, qr };
  } catch (e) {
    return securityFailure(e);
  }
}

export async function confirmTwoFactorAction(code: string): Promise<SecurityResult> {
  const ctx = await requireContext();
  try {
    const codes = await confirmSetup(ctx.user.userId, code);
    // Every other device signs in again, now with the second factor.
    await endOtherSessions(ctx.user.userId, ctx.user.sessionId);
    revalidatePath("/app/settings");
    return { ok: true, codes };
  } catch (e) {
    return securityFailure(e);
  }
}

export async function disableTwoFactorAction(code: string): Promise<SecurityResult> {
  const ctx = await requireContext();
  try {
    await disableTwoFactor(ctx.user.userId, code);
    revalidatePath("/app/settings");
    return { ok: true };
  } catch (e) {
    return securityFailure(e);
  }
}

export async function recoveryCodesAction(code: string): Promise<SecurityResult> {
  const ctx = await requireContext();
  try {
    const codes = await newRecoveryCodesFor(ctx.user.userId, code);
    revalidatePath("/app/settings");
    return { ok: true, codes };
  } catch (e) {
    return securityFailure(e);
  }
}

export async function changePasswordAction(current: string, next: string): Promise<SecurityResult> {
  const ctx = await requireContext();
  try {
    await changePassword(ctx.user.userId, ctx.user.sessionId, current, next);
    await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, "auth.password", "user", ctx.user.userId));
    revalidatePath("/app/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof PasswordChangeError) return { error: e.code === "TOO_SHORT" ? "auth.passwordHint" : "privacy.WRONG_PASSWORD" };
    throw e;
  }
}

export async function resendVerificationAction(): Promise<SecurityResult> {
  const ctx = await requireContext();
  if (!takeMailThrottle(`verify:${ctx.user.userId}`)) return { error: "send.LIMIT" };
  const sent = await sendVerificationMail(ctx.user.userId, ctx.user.email, isLocale(ctx.user.locale) ? ctx.user.locale : "de", await publicBase());
  return sent ? { ok: true } : { error: "common.error" };
}

export async function endSessionAction(id: string): Promise<SecurityResult> {
  const ctx = await requireContext();
  if (id !== ctx.user.sessionId) await endSession(ctx.user.userId, id);
  revalidatePath("/app/settings");
  return { ok: true };
}

export async function endOtherSessionsAction(): Promise<SecurityResult> {
  const ctx = await requireContext();
  await endOtherSessions(ctx.user.userId, ctx.user.sessionId);
  revalidatePath("/app/settings");
  return { ok: true };
}

export async function deleteCompanyAction(confirmName: string, password: string): Promise<SecurityResult> {
  const ctx = await requireContext();
  try {
    await deleteCompany(ctx, confirmName, password);
  } catch (e) {
    if (e instanceof PrivacyError) return { error: `privacy.${e.code}` };
    throw e;
  }
  redirect("/app");
}

export async function deleteAccountAction(password: string): Promise<SecurityResult> {
  const ctx = await requireContext();
  try {
    await deleteAccount(ctx.user, password);
  } catch (e) {
    if (e instanceof PrivacyError) return { error: `privacy.${e.code}` };
    throw e;
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function setLogoAction(documentId: string | null): Promise<SecurityResult> {
  const ctx = await requireContext();
  try {
    await setCompanyLogo(ctx, documentId);
    revalidatePath("/app/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    return { error: "documents.TYPE" };
  }
}

export async function calendarLinkAction(): Promise<{ url: string }> {
  const ctx = await requireContext();
  return { url: `${await publicBase()}/api/calendar/${await newCalendarLink(ctx)}.ics` };
}

export async function saveAreasAction(areas: string[]): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  try {
    await setCompanyAreas(ctx, areas);
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof AreaError) return { error: `areas.error.${e.code}` };
    if (e instanceof ZodError) return { error: "auth.check" };
    throw e;
  }
}
