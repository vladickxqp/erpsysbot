/**
 * Telegram notifications:
 * - the morning summary from 8 o'clock in the company's time zone, once a day,
 *   to everyone with a linked account and notifications on — only when there
 *   is something to act on (appointments, overdue invoices and tasks, orders
 *   due, follow-ups);
 * - a reminder about an hour before each of one's appointments.
 */
import { and, eq, gt, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { appointments, clients, organizations, telegramLinks, users } from "@/db/schema";
import { formatMoney, isLocale, MESSAGES, translator } from "@/i18n";
import { dayBounds, listAppointments, localParts } from "../calendar";
import { displayName } from "../clients";
import { contextFor } from "../context";
import { dueFollowUps } from "../deals";
import { listOrders } from "../orders";
import { today } from "../money";
import { overdueInvoices } from "../reminders";
import { appUrl } from "../settings";
import { listTasks } from "../tasks";
import { escapeHtml as h, sendMessage } from "./api";

const HOUR = 8;

function localHour(timeZone: string, at = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(at)) % 24;
}

type Send = (chatId: string, html: string) => Promise<void>;

/** Sends what is due now; returns how many summaries went out. */
export async function sendDigests(send: Send = sendMessage, at = new Date()): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ link: telegramLinks, user: users, org: organizations })
    .from(telegramLinks)
    .innerJoin(users, eq(users.id, telegramLinks.userId))
    .innerJoin(organizations, eq(organizations.id, telegramLinks.organizationId))
    .where(and(eq(telegramLinks.notify, true), isNotNull(telegramLinks.organizationId)));
  let sent = 0;
  for (const { link, user, org } of rows) {
    const day = today(org.timezone, at);
    if (link.lastDigestOn === day || localHour(org.timezone, at) < HOUR) continue;
    // Claim the day first, so two servers or a crash never send twice.
    const claimed = await db
      .update(telegramLinks)
      .set({ lastDigestOn: day })
      .where(and(eq(telegramLinks.id, link.id), or(isNull(telegramLinks.lastDigestOn), ne(telegramLinks.lastDigestOn, day))))
      .returning({ id: telegramLinks.id });
    if (!claimed.length) continue;
    try {
      const text = await digestFor({ userId: user.id, email: user.email, name: user.name, locale: user.locale, isPlatformAdmin: user.isPlatformAdmin, organizationId: org.id }, day);
      if (!text) continue;
      await send(link.chatId, text);
      sent++;
    } catch (e) {
      console.error("telegram: digest failed", e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

async function digestFor(
  user: { userId: string; email: string; name: string; locale: string; isPlatformAdmin: boolean; organizationId: string },
  day: string,
): Promise<string | null> {
  const ctx = await contextFor({ sessionId: "digest", ...user, activeOrganizationId: user.organizationId });
  if (!ctx || ctx.organization.id !== user.organizationId) return null;
  const locale = isLocale(user.locale) ? user.locale : "de";
  const t = translator(MESSAGES[locale]);
  const base = appUrl();
  const lines: string[] = [];
  const section = (title: string, rows: string[]) => {
    if (lines.length) lines.push("");
    lines.push(title, ...rows);
  };

  if (ctx.permissions.has("calendar.read")) {
    const tz = ctx.organization.timezone;
    const items = await listAppointments(ctx, { ...dayBounds(day, tz), userId: ctx.user.userId, activeOnly: true });
    if (items.length) {
      section(
        `📅 <b>${t("digest.appointments", { count: items.length })}</b>`,
        items.slice(0, 8).map((a) => h(`${localParts(a.startsAt, tz).time} ${a.title}${a.clientName ? ` · ${a.clientName}` : ""}`)),
      );
    }
  }
  if (ctx.permissions.has("tasks.read")) {
    const late = await listTasks(ctx, { assignedUserId: ctx.user.userId, overdue: true });
    const dueToday = (await listTasks(ctx, { assignedUserId: ctx.user.userId, open: true })).filter((task) => task.dueDate === day);
    if (late.length || dueToday.length) {
      section(
        `✅ <b>${t("digest.tasks", { late: late.length, today: dueToday.length })}</b>`,
        [...late, ...dueToday].slice(0, 6).map((task) => h(`${task.title}`)),
      );
    }
  }
  if (ctx.permissions.has("clients.read")) {
    const followUps = await dueFollowUps(ctx, ctx.user.userId);
    if (followUps.length) {
      section(`📞 <b>${t("digest.followUps", { count: followUps.length })}</b>`, followUps.slice(0, 5).map((d) => h(`${d.title} · ${d.clientName}`)));
    }
  }
  if (ctx.permissions.has("invoices.read")) {
    const overdue = await overdueInvoices(ctx);
    if (overdue.length) {
      const sum = overdue.reduce((s, i) => s + i.openCents, 0);
      section(
        `⚠️ <b>${t("digest.overdue", { count: overdue.length, amount: formatMoney(sum, locale) })}</b>`,
        overdue.slice(0, 5).map((i) => {
          const label = h(`${i.number} · ${i.clientName} · ${formatMoney(i.openCents, locale)}`);
          return base ? `<a href="${base}/app/invoices/${i.id}">${label}</a>` : label;
        }),
      );
    }
  }
  if (ctx.permissions.has("orders.read")) {
    const { rows } = await listOrders(ctx, { status: "OPEN", pageSize: 100 });
    const due = rows.filter((o) => o.dueDate && o.dueDate <= day);
    if (due.length) {
      section(
        `📦 <b>${t("digest.ordersDue", { count: due.length })}</b>`,
        due.slice(0, 5).map((o) => h(`#${o.number} ${o.title ?? ""} · ${o.clientName}`.replace(/\s+·/, " ·"))),
      );
    }
  }
  if (!lines.length) return null;
  return [`☀️ <b>${h(ctx.organization.name)}</b>`, "", ...lines].join("\n");
}

/** Appointments starting within the next 70 minutes, not yet reminded, to the linked assignee. */
export async function sendAppointmentReminders(send: Send = sendMessage, at = new Date()): Promise<number> {
  const db = getDb();
  const soon = new Date(at.getTime() + 70 * 60_000);
  const rows = await db
    .select({
      appointment: appointments,
      chatId: telegramLinks.chatId,
      locale: users.locale,
      timezone: organizations.timezone,
      client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName },
    })
    .from(appointments)
    .innerJoin(telegramLinks, and(eq(telegramLinks.userId, appointments.assignedUserId), eq(telegramLinks.notify, true)))
    .innerJoin(users, eq(users.id, appointments.assignedUserId))
    .innerJoin(organizations, eq(organizations.id, appointments.organizationId))
    .leftJoin(clients, eq(clients.id, appointments.clientId))
    .where(
      and(
        isNull(appointments.remindedAt),
        inArray(appointments.status, ["PENDING", "CONFIRMED"]),
        gt(appointments.startsAt, at),
        lt(appointments.startsAt, soon),
      ),
    );
  let sent = 0;
  for (const row of rows) {
    const claimed = await db
      .update(appointments)
      .set({ remindedAt: at })
      .where(and(eq(appointments.id, row.appointment.id), isNull(appointments.remindedAt)))
      .returning({ id: appointments.id });
    if (!claimed.length) continue;
    const t = translator(MESSAGES[isLocale(row.locale) ? row.locale : "de"]);
    const a = row.appointment;
    const text = [
      `⏰ <b>${h(localParts(a.startsAt, row.timezone).time)} ${h(a.title)}</b>`,
      row.client ? h(displayName(row.client)) : null,
      a.location ? `📍 ${h(a.location)}` : null,
      t("digest.soon"),
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await send(row.chatId, text);
      sent++;
    } catch (e) {
      console.error("telegram: reminder failed", e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Checks every 5 minutes; started with the server. */
export function startDigestTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    sendAppointmentReminders().catch((e) => console.error("telegram: reminders failed", e instanceof Error ? e.message : e));
    sendDigests().catch((e) => console.error("telegram: digest run failed", e instanceof Error ? e.message : e));
  }, 5 * 60_000);
  timer.unref?.();
}
