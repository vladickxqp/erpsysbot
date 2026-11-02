"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { CalendarError, createAppointment, deleteAppointment, updateAppointment, zonedTime, type AppointmentStatus } from "@/server/calendar";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export type AppointmentPayload = {
  title: string;
  clientId: string | null;
  assignedUserId: string | null;
  date: string;
  start: string;
  end: string;
  location: string;
  status: AppointmentStatus;
  notes: string;
  repeatWeeks: number;
};

export type CalendarResult = { ok?: boolean; error?: string; clash?: string };

function failure(e: unknown): CalendarResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  if (e instanceof CalendarError) return { error: `calendar.${e.code}`, clash: e.clash?.title };
  throw e;
}

export async function saveAppointmentAction(id: string | null, p: AppointmentPayload): Promise<CalendarResult> {
  const ctx = await requireContext();
  const tz = ctx.organization.timezone;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !/^\d{2}:\d{2}$/.test(p.start) || !/^\d{2}:\d{2}$/.test(p.end)) return { error: "auth.check" };
  const input = {
    title: p.title,
    clientId: p.clientId,
    assignedUserId: p.assignedUserId,
    startsAt: zonedTime(p.date, p.start, tz),
    endsAt: zonedTime(p.date, p.end, tz),
    location: p.location,
    status: p.status,
    notes: p.notes,
    repeatWeeks: id ? 0 : p.repeatWeeks,
  };
  try {
    if (id) await updateAppointment(ctx, id, input);
    else await createAppointment(ctx, input);
    revalidatePath("/app/calendar");
    revalidatePath("/app");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteAppointmentAction(id: string): Promise<CalendarResult> {
  const ctx = await requireContext();
  try {
    await deleteAppointment(ctx, id);
    revalidatePath("/app/calendar");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
