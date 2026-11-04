/**
 * A personal calendar link (iCalendar) for phones, Google and Outlook: one's
 * appointments, due tasks and planned content. The link is the password, so
 * only its hash is stored; a new link ends the old one.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { memberships, users } from "@/db/schema";
import { dayBounds, listAppointments } from "./calendar";
import { listContent } from "./content";
import { contextFor, type Context } from "./context";
import { addDays, today } from "./money";
import { isSuspended } from "./platform";
import { listTasks } from "./tasks";

const sha = (token: string) => createHash("sha256").update(token).digest("hex");

export async function newCalendarLink(ctx: Context): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await getDb()
    .update(memberships)
    .set({ calendarTokenHash: sha(token) })
    .where(and(eq(memberships.organizationId, ctx.organization.id), eq(memberships.userId, ctx.user.userId)));
  return token;
}

const escape = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (at: Date) => at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Lines longer than 75 octets continue on the next line (RFC 5545). */
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 73) {
    let cut = 73;
    while (Buffer.byteLength(rest.slice(0, cut)) > 73) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join("\r\n");
};

export function icsCalendar(name: string, events: { uid: string; title: string; start: Date | string; end?: Date; allDay?: boolean }[], now = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NEXORA ONE//Calendar//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escape(name)}`];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp(now)}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${String(e.start).replace(/-/g, "")}`);
    else {
      lines.push(`DTSTART:${stamp(new Date(e.start))}`);
      if (e.end) lines.push(`DTEND:${stamp(e.end)}`);
    }
    lines.push(`SUMMARY:${escape(e.title)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** The calendar behind a link, or null when the link is unknown or the company closed. */
export async function calendarForToken(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [row] = await getDb()
    .select({ membership: memberships, user: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.calendarTokenHash, sha(token)))
    .limit(1);
  if (!row || (await isSuspended(row.membership.organizationId))) return null;
  const { user } = row;
  const ctx = await contextFor({
    sessionId: "calendar",
    userId: user.id,
    email: user.email,
    name: user.name,
    locale: user.locale,
    isPlatformAdmin: false,
    activeOrganizationId: row.membership.organizationId,
  });
  if (!ctx) return null;
  const tz = ctx.organization.timezone;
  const now = today(tz);
  const range = { from: dayBounds(addDays(now, -30), tz).from, to: dayBounds(addDays(now, 180), tz).to };
  const events: Parameters<typeof icsCalendar>[1] = [];
  if (ctx.permissions.has("calendar.read")) {
    for (const a of await listAppointments(ctx, { ...range, userId: user.id, activeOnly: true })) {
      events.push({ uid: `appointment-${a.id}@nexora`, title: a.title, start: a.startsAt, end: a.endsAt });
    }
  }
  if (ctx.permissions.has("tasks.read")) {
    for (const t of await listTasks(ctx, { assignedUserId: user.id, open: true })) {
      if (t.dueDate) events.push({ uid: `task-${t.id}@nexora`, title: t.title, start: t.dueDate, allDay: true });
    }
  }
  if (ctx.permissions.has("content.read") && !ctx.disabledModules.has("content")) {
    for (const c of await listContent(ctx, range)) {
      const at = c.publishedAt ?? c.scheduledAt;
      if (at && c.assignedUserId === user.id) events.push({ uid: `content-${c.id}@nexora`, title: c.title, start: at });
    }
  }
  return icsCalendar(ctx.organization.name, events);
}
