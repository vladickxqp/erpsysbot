"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { zonedTime } from "@/server/calendar";
import { NotFoundError } from "@/server/clients";
import { parseMoney } from "@/server/money";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { addEntry, billClient, deleteEntry, startTimer, stopTimer, TimeError, type TimerInput } from "@/server/time";

export type TimeResult = { ok?: boolean; id?: string; error?: string };

function failure(e: unknown): TimeResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  if (e instanceof TimeError) return { error: `time.${e.code}` };
  throw e;
}

const refresh = () => {
  revalidatePath("/app/time");
  revalidatePath("/app/tasks", "layout");
};

export async function startTimerAction(input: TimerInput): Promise<TimeResult> {
  const ctx = await requireContext();
  try {
    await startTimer(ctx, input);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function stopTimerAction(): Promise<TimeResult> {
  const ctx = await requireContext();
  try {
    await stopTimer(ctx);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** A hand-written entry: a day and local times, in the company's zone. */
export async function addEntryAction(input: TimerInput & { date: string; start: string; end: string }): Promise<TimeResult> {
  const ctx = await requireContext();
  try {
    const { date, start, end, ...rest } = input;
    const tz = ctx.organization.timezone;
    await addEntry(ctx, { ...rest, startedAt: zonedTime(date, start, tz), endedAt: zonedTime(date, end, tz) });
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteEntryAction(id: string): Promise<TimeResult> {
  const ctx = await requireContext();
  try {
    await deleteEntry(ctx, id);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function billClientAction(clientId: string, rate: string): Promise<TimeResult> {
  const ctx = await requireContext();
  try {
    const cents = parseMoney(rate);
    if (!cents || cents <= 0) return { error: "auth.check" };
    const invoice = await billClient(ctx, clientId, cents);
    refresh();
    revalidatePath("/app/invoices");
    return { ok: true, id: invoice.id };
  } catch (e) {
    return failure(e);
  }
}
