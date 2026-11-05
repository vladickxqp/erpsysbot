"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { MESSAGES, isLocale, translator } from "@/i18n";
import { BillingError } from "@/server/billing";
import { emailVerified } from "@/server/auth/email-verification";
import { mailAvailable, sendMail, takeMailBudget } from "@/server/mail";
import { registrationOpen } from "@/server/settings";
import { ForbiddenError, type Role } from "@/server/permissions";
import { publicBase, requireContext } from "@/server/request";
import { assignDepartment, deleteDepartment, saveDepartment } from "@/server/departments";
import { TeamError, assignCustomRole, changeRole, deleteCustomRole, inviteMember, passwordLinkForMember, removeMember, revokeInvitation, saveCustomRole, setMemberPermissions } from "@/server/team";

export type TeamResult = { ok?: boolean; url?: string; mailed?: boolean; error?: string };

async function guarded(work: () => Promise<TeamResult>): Promise<TeamResult> {
  try {
    const result = await work();
    revalidatePath("/app/team");
    return result;
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof TeamError) return { error: `team.${e.code}` };
    if (e instanceof BillingError) return { error: `billing.${e.code}` };
    if (e instanceof ZodError) return { error: "auth.check" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    throw e;
  }
}

export async function permissionsAction(userId: string, permissions: string[]): Promise<TeamResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    await setMemberPermissions(ctx, userId, permissions);
    return { ok: true };
  });
}

export async function saveCustomRoleAction(id: string | null, name: string, permissions: string[]): Promise<TeamResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    await saveCustomRole(ctx, id, { name, permissions });
    return { ok: true };
  });
}

export async function deleteCustomRoleAction(id: string): Promise<TeamResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    await deleteCustomRole(ctx, id);
    return { ok: true };
  });
}

export async function assignCustomRoleAction(userId: string, roleId: string | null): Promise<TeamResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    await assignCustomRole(ctx, userId, roleId);
    return { ok: true };
  });
}

export async function saveDepartmentAction(name: string): Promise<TeamResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    await saveDepartment(ctx, null, { name });
    return { ok: true };
  });
}

export async function deleteDepartmentAction(id: string): Promise<TeamResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    await deleteDepartment(ctx, id);
    return { ok: true };
  });
}

export async function assignDepartmentAction(userId: string, departmentId: string | null): Promise<TeamResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    await assignDepartment(ctx, userId, departmentId);
    return { ok: true };
  });
}

export async function inviteAction(email: string, role: Role): Promise<TeamResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    const invite = await inviteMember(ctx, { email, role: role as never });
    const url = `${await publicBase()}/invite/${invite.token}`;
    let mailed = false;
    // Unproven people get the link to pass on; the shared sender stays out of it on open sign-up.
    const mayMail = !registrationOpen() || (await emailVerified(ctx.user.userId));
    if (mailAvailable() && mayMail && takeMailBudget(ctx.organization.id)) {
      const t = translator(MESSAGES[isLocale(ctx.user.locale) ? ctx.user.locale : "de"]);
      mailed = await sendMail({
        to: invite.email,
        subject: t("mail.inviteSubject", { company: ctx.organization.name }),
        text: t("mail.inviteText", { company: ctx.organization.name, name: ctx.user.name, url }),
      }).catch((e) => {
        console.error("mail: invitation failed", e instanceof Error ? e.message : e);
        return false;
      });
    }
    return { ok: true, url, mailed };
  });
}

export async function revokeAction(id: string): Promise<TeamResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    await revokeInvitation(ctx, id);
    return { ok: true };
  });
}

export async function roleAction(userId: string, role: Role): Promise<TeamResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    await changeRole(ctx, userId, role);
    return { ok: true };
  });
}

export async function removeAction(userId: string): Promise<TeamResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    await removeMember(ctx, userId);
    return { ok: true };
  });
}

export async function passwordLinkAction(userId: string): Promise<TeamResult> {
  const ctx = await requireContext();
  return guarded(async () => ({ ok: true, url: `${await publicBase()}/reset/${await passwordLinkForMember(ctx, userId)}` }));
}
