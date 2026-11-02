/**
 * Appointments: who meets whom, when and where. One person's appointments
 * may not overlap (cancelled and no-show ones aside); recurring series are
 * stored as single appointments, so moving one never moves the others.
 */
import { and, asc, eq, gt, inArray, lt, ne, notInArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/tenant";
import { appointments, clients } from "@/db/schema";
import { audit, type Via } from "./audit";
import { displayName, NotFoundError } from "./clients";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

export const APPOINTMENT_STATUSES = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type Appointment = typeof appointments.$inferSelect;

const MAX_SERIES = 52;

export class CalendarError extends Error {
  constructor(public readonly code: "OVERLAP" | "END_BEFORE_START", public readonly clash?: { title: string; startsAt: Date }) {
    super(code);
  }
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const appointmentInput = z.object({
  title: z.string().trim().min(1).max(200),
  clientId: z.string().uuid().nullish().transform((v) => v || null),
  assignedUserId: z.string().uuid().nullish().transform((v) => v || null),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  location: optional(200),
  status: z.enum(APPOINTMENT_STATUSES).default("CONFIRMED"),
  notes: optional(5000),
  /** Repeat weekly this many more times (create only). */
  repeatWeeks: z.coerce.number().int().min(0).max(MAX_SERIES).default(0),
});
export type AppointmentInput = z.input<typeof appointmentInput>;

const BLOCKING: AppointmentStatus[] = ["PENDING", "CONFIRMED", "COMPLETED"];

async function assertFree(tx: Tx, userId: string | null, startsAt: Date, endsAt: Date, except?: string) {
  if (!userId) return;
  const filters: SQL[] = [
    eq(appointments.assignedUserId, userId),
    inArray(appointments.status, BLOCKING),
    lt(appointments.startsAt, endsAt),
    gt(appointments.endsAt, startsAt),
  ];
  if (except) filters.push(ne(appointments.id, except));
  const [clash] = await tx.select({ title: appointments.title, startsAt: appointments.startsAt }).from(appointments).where(and(...filters)).limit(1);
  if (clash) throw new CalendarError("OVERLAP", clash);
}

async function clientInCompany(tx: Tx, clientId: string | null) {
  if (!clientId) return;
  const [row] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!row) throw new NotFoundError();
}

export async function createAppointment(ctx: Context, raw: AppointmentInput, via: Via = "web"): Promise<Appointment[]> {
  requirePermission(ctx.permissions, "calendar.manage");
  const input = appointmentInput.parse(raw);
  if (input.endsAt <= input.startsAt) throw new CalendarError("END_BEFORE_START");
  const assignee = input.assignedUserId ?? ctx.user.userId;
  return withTenant(ctx.organization.id, async (tx) => {
    await clientInCompany(tx, input.clientId);
    const created: Appointment[] = [];
    for (let week = 0; week <= input.repeatWeeks; week++) {
      const shift = week * 7 * 86_400_000;
      const startsAt = new Date(input.startsAt.getTime() + shift);
      const endsAt = new Date(input.endsAt.getTime() + shift);
      if (BLOCKING.includes(input.status)) await assertFree(tx, assignee, startsAt, endsAt);
      const [row] = await tx
        .insert(appointments)
        .values({
          organizationId: ctx.organization.id,
          title: input.title,
          clientId: input.clientId,
          assignedUserId: assignee,
          startsAt,
          endsAt,
          location: input.location,
          status: input.status,
          notes: input.notes,
          createdBy: ctx.user.userId,
        })
        .returning();
      created.push(row);
    }
    if (input.clientId) await tx.update(clients).set({ lastInteractionAt: new Date() }).where(eq(clients.id, input.clientId));
    await audit(tx, ctx, "appointment.create", "appointment", created[0].id, { title: input.title, count: created.length }, via);
    return created;
  });
}

export async function updateAppointment(ctx: Context, id: string, raw: AppointmentInput, via: Via = "web"): Promise<Appointment> {
  requirePermission(ctx.permissions, "calendar.manage");
  const input = appointmentInput.parse(raw);
  if (input.endsAt <= input.startsAt) throw new CalendarError("END_BEFORE_START");
  return withTenant(ctx.organization.id, async (tx) => {
    const [current] = await tx.select().from(appointments).where(eq(appointments.id, id)).limit(1);
    if (!current) throw new NotFoundError();
    await clientInCompany(tx, input.clientId);
    const assignee = input.assignedUserId ?? current.assignedUserId;
    if (BLOCKING.includes(input.status)) await assertFree(tx, assignee, input.startsAt, input.endsAt, id);
    const [row] = await tx
      .update(appointments)
      .set({
        title: input.title,
        clientId: input.clientId,
        assignedUserId: assignee,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        location: input.location,
        status: input.status,
        notes: input.notes,
        // A moved appointment is reminded again.
        remindedAt: current.startsAt.getTime() === input.startsAt.getTime() ? current.remindedAt : null,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, id))
      .returning();
    await audit(tx, ctx, "appointment.update", "appointment", id, { status: input.status }, via);
    return row;
  });
}

export async function setAppointmentStatus(ctx: Context, id: string, status: AppointmentStatus, via: Via = "web") {
  requirePermission(ctx.permissions, "calendar.manage");
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.update(appointments).set({ status, updatedAt: new Date() }).where(eq(appointments.id, id)).returning();
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "appointment.status", "appointment", id, { status }, via);
    return row;
  });
}

export async function deleteAppointment(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "calendar.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(appointments).where(eq(appointments.id, id)).returning({ title: appointments.title });
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "appointment.delete", "appointment", id, { title: row.title });
  });
}

/** Appointments overlapping [from, to), with client names; optionally one person's or one client's. */
export async function listAppointments(ctx: Context, range: { from: Date; to: Date; userId?: string; clientId?: string; activeOnly?: boolean }) {
  requirePermission(ctx.permissions, "calendar.read");
  const filters: SQL[] = [lt(appointments.startsAt, range.to), gt(appointments.endsAt, range.from)];
  if (range.userId) filters.push(eq(appointments.assignedUserId, range.userId));
  if (range.clientId) filters.push(eq(appointments.clientId, range.clientId));
  if (range.activeOnly) filters.push(notInArray(appointments.status, ["CANCELLED", "NO_SHOW"]));
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ appointment: appointments, client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName } })
      .from(appointments)
      .leftJoin(clients, eq(clients.id, appointments.clientId))
      .where(and(...filters))
      .orderBy(asc(appointments.startsAt))
      .limit(1000);
    return rows.map((r) => ({ ...r.appointment, clientName: r.client ? displayName(r.client) : null }));
  });
}

export async function getAppointment(ctx: Context, id: string): Promise<Appointment> {
  requirePermission(ctx.permissions, "calendar.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.select().from(appointments).where(eq(appointments.id, id)).limit(1);
    if (!row) throw new NotFoundError();
    return row;
  });
}

/** Start and end of a calendar day in a time zone, as instants. */
export function dayBounds(isoDate: string, timeZone: string): { from: Date; to: Date } {
  const next = new Date(`${isoDate}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { from: zonedTime(isoDate, "00:00", timeZone), to: zonedTime(next.toISOString().slice(0, 10), "00:00", timeZone) };
}

/** "2026-11-03" + "10:30" in Europe/Berlin → the instant. Correct across summer-time changes. */
export function zonedTime(isoDate: string, hhmm: string, timeZone: string): Date {
  const target = Date.parse(`${isoDate}T${hhmm}:00Z`);
  let guess = new Date(target);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(guess);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    guess = new Date(guess.getTime() - (local - target));
  }
  return guess;
}

/** An instant as local date and time in a zone: { date: "2026-11-03", time: "10:30" }. */
export function localParts(at: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}` };
}
