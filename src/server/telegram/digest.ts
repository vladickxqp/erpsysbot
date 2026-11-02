/**
 * The morning summary in Telegram: from 8 o'clock in the company's time zone,
 * once a day, to everyone with a linked account and notifications on — only
 * when there is something to act on (overdue invoices, orders due today).
 */
import { and, eq, isNotNull, ne, or, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organizations, telegramLinks, users } from "@/db/schema";
import { formatMoney, isLocale, MESSAGES, translator } from "@/i18n";
import { contextFor } from "../context";
import { listOrders } from "../orders";
import { today } from "../money";
import { overdueInvoices } from "../reminders";
import { appUrl } from "../settings";
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

  if (ctx.permissions.has("invoices.read")) {
    const overdue = await overdueInvoices(ctx);
    if (overdue.length) {
      const sum = overdue.reduce((s, i) => s + i.openCents, 0);
      lines.push(`⚠️ <b>${t("digest.overdue", { count: overdue.length, amount: formatMoney(sum, locale) })}</b>`);
      for (const i of overdue.slice(0, 5)) {
        const label = h(`${i.number} · ${i.clientName} · ${formatMoney(i.openCents, locale)}`);
        lines.push(base ? `<a href="${base}/app/invoices/${i.id}">${label}</a>` : label);
      }
    }
  }
  if (ctx.permissions.has("orders.read")) {
    const { rows } = await listOrders(ctx, { status: "OPEN", pageSize: 100 });
    const due = rows.filter((o) => o.dueDate && o.dueDate <= day);
    if (due.length) {
      lines.push("", `📦 <b>${t("digest.ordersDue", { count: due.length })}</b>`);
      for (const o of due.slice(0, 5)) lines.push(h(`#${o.number} ${o.title ?? ""} · ${o.clientName}`.replace(/\s+·/, " ·")));
    }
  }
  if (!lines.length) return null;
  return [`☀️ <b>${h(ctx.organization.name)}</b>`, "", ...lines].join("\n");
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Checks every 10 minutes; started with the server. */
export function startDigestTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    sendDigests().catch((e) => console.error("telegram: digest run failed", e instanceof Error ? e.message : e));
  }, 10 * 60_000);
  timer.unref?.();
}
