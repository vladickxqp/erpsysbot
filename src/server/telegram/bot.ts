/**
 * The Telegram bot: commands for a quick look, free text for the assistant.
 *
 * Every update is answered on behalf of the linked user in the company stored
 * on the link — with that user's role, exactly as in the app. Unlinked
 * accounts only get the way to link.
 */
import { openCents } from "@/lib/invoicing";
import { isSuspended } from "../platform";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { fromAcceptLanguage, isLocale, MESSAGES, formatDate, formatMoney, regionOf, translator, type Locale, type T } from "@/i18n";
import { AssistantError, askAssistant, assistantAvailable, clearConversation } from "../assistant/run";
import { dayBounds, listAppointments, localParts } from "../calendar";
import { displayName, listClients } from "../clients";
import { contextFor, type Context } from "../context";
import { ForbiddenError } from "../permissions";
import { invoiceStats, openOrderStats } from "../dashboard";
import { financeSummary } from "../finance";
import { listInvoices } from "../invoices";
import { today } from "../money";
import { appUrl } from "../settings";
import { listTasks } from "../tasks";
import { callTelegram, escapeHtml as h, sendMessage, type Keyboard } from "./api";
import { linkOfTelegram, redeemLinkToken, setLinkCompany, setNotify, unlink, type TelegramLink } from "./links";

type TgUser = { id: number; username?: string; language_code?: string };
export type Update = {
  update_id: number;
  message?: { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string };
  callback_query?: { id: string; from: TgUser; data?: string; message?: { chat: { id: number } } };
};

export type BotIO = {
  send: (chatId: string, html: string, keyboard?: Keyboard) => Promise<void>;
  answerCallback: (id: string) => Promise<void>;
  typing: (chatId: string) => Promise<void>;
};

const liveIO: BotIO = {
  send: sendMessage,
  answerCallback: (id) => callTelegram("answerCallbackQuery", { callback_query_id: id }).then(() => undefined),
  typing: (chatId) => callTelegram("sendChatAction", { chat_id: chatId, action: "typing" }).then(() => undefined),
};

/** Per Telegram account: at most 20 messages a minute. */
const recent = new Map<string, number[]>();
function tooFast(tgId: string): boolean {
  const now = Date.now();
  const hits = (recent.get(tgId) ?? []).filter((at) => now - at < 60_000);
  hits.push(now);
  recent.set(tgId, hits);
  return hits.length > 20;
}

export const BOT_COMMANDS = ["today", "calendar", "tasks", "invoices", "clients", "company", "notify", "new", "help"] as const;

export function commandList(locale: Locale) {
  const t = translator(MESSAGES[locale]);
  return BOT_COMMANDS.map((command) => ({ command, description: t(`bot.cmd.${command}`) }));
}

async function contextOf(link: TelegramLink): Promise<Context | null> {
  const [user] = await getDb().select().from(users).where(eq(users.id, link.userId));
  if (!user) return null;
  // A suspended company (or one still in review) is closed in the chat as well.
  if (link.organizationId && !user.isPlatformAdmin && (await isSuspended(link.organizationId))) return null;
  return contextFor({
    sessionId: "telegram",
    userId: user.id,
    email: user.email,
    name: user.name,
    locale: user.locale,
    isPlatformAdmin: user.isPlatformAdmin,
    activeOrganizationId: link.organizationId,
  });
}

const localeOf = (ctx: Context | null, from?: TgUser): Locale =>
  ctx && isLocale(ctx.user.locale) ? ctx.user.locale : fromAcceptLanguage(from?.language_code);

export async function handleUpdate(update: Update, io: BotIO = liveIO): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query, io);
  const msg = update.message;
  if (!msg?.from || !msg.text || msg.chat.type !== "private") return;
  const chatId = String(msg.chat.id);
  const tgId = String(msg.from.id);
  if (tooFast(tgId)) return;

  const text = msg.text.trim();
  const [head, ...rest] = text.split(/\s+/);
  const command = head.startsWith("/") ? head.slice(1).split("@")[0].toLowerCase() : null;
  const arg = rest.join(" ").trim();

  if (command === "start" && arg) {
    const result = await redeemLinkToken(arg, { userId: tgId, chatId, username: msg.from.username ?? null });
    const ctx = result.ok ? await contextOf(result.link) : null;
    const t = translator(MESSAGES[localeOf(ctx, msg.from)]);
    if (!result.ok || !ctx) return io.send(chatId, t(result.ok || result.reason === "invalid" ? "bot.linkInvalid" : "bot.linkTaken"));
    return io.send(chatId, `${t("bot.linked", { company: h(ctx.organization.name) })}\n\n${help(t)}`);
  }

  const link = await linkOfTelegram(tgId);
  const ctx = link ? await contextOf(link) : null;
  const t = translator(MESSAGES[localeOf(ctx, msg.from)]);
  if (!link || !ctx) {
    const url = appUrl();
    return io.send(chatId, t("bot.notLinked"), url ? [[{ text: t("bot.openApp"), url: `${url}/app/settings` }]] : undefined);
  }

  switch (command) {
    case "start":
    case "help":
      return io.send(chatId, help(t));
    case "today":
      return io.send(chatId, await todayText(ctx, t));
    case "calendar":
      return io.send(chatId, await calendarText(ctx, t));
    case "tasks":
      return io.send(chatId, await tasksText(ctx, t));
    case "invoices":
      return io.send(chatId, await invoicesText(ctx, t));
    case "clients":
      return io.send(chatId, await clientsText(ctx, t, arg));
    case "company":
      if (ctx.companies.length < 2) return io.send(chatId, t("bot.oneCompany", { company: h(ctx.organization.name) }));
      return io.send(
        chatId,
        t("bot.pickCompany"),
        ctx.companies.map((c) => [{ text: `${c.id === ctx.organization.id ? "✓ " : ""}${c.name}`, callback_data: `co:${c.id}` }]),
      );
    case "notify":
      await setNotify(ctx.user.userId, !link.notify);
      return io.send(chatId, t(link.notify ? "bot.notifyOff" : "bot.notifyOn"));
    case "new":
      await clearConversation(ctx, "telegram");
      return io.send(chatId, t("bot.cleared"));
    case "unlink":
      await unlink(ctx.user.userId);
      return io.send(chatId, t("bot.unlinked"));
    case null:
      return ask(ctx, t, chatId, text, io);
    default:
      return io.send(chatId, help(t));
  }
}

async function handleCallback(q: NonNullable<Update["callback_query"]>, io: BotIO): Promise<void> {
  await io.answerCallback(q.id).catch(() => undefined);
  const chatId = q.message ? String(q.message.chat.id) : null;
  const link = await linkOfTelegram(String(q.from.id));
  if (!chatId || !link || !q.data?.startsWith("co:")) return;
  if (!(await setLinkCompany(link.userId, q.data.slice(3)))) return;
  const ctx = await contextOf({ ...link, organizationId: q.data.slice(3) });
  if (!ctx) return;
  const t = translator(MESSAGES[localeOf(ctx, q.from)]);
  await io.send(chatId, t("bot.switched", { company: h(ctx.organization.name) }));
}

function help(t: T): string {
  return [t("bot.help"), "", ...BOT_COMMANDS.filter((c) => c !== "help").map((c) => `/${c} — ${t(`bot.cmd.${c}`)}`)].join("\n");
}

async function ask(ctx: Context, t: T, chatId: string, text: string, io: BotIO): Promise<void> {
  if (!assistantAvailable() || !ctx.permissions.has("ai.use")) return io.send(chatId, help(t));
  await io.typing(chatId).catch(() => undefined);
  try {
    const answer = await askAssistant(ctx, "telegram", text);
    await io.send(chatId, h(answer));
  } catch (e) {
    if (e instanceof ForbiddenError) return io.send(chatId, t("common.forbidden"));
    if (!(e instanceof AssistantError)) throw e;
    const key = { NOT_CONFIGURED: "assistant.notConfigured", LIMIT: "assistant.limit", BUSY: "assistant.busy", REFUSED: "assistant.refused", FAILED: "assistant.failed" }[e.code];
    await io.send(chatId, t(key));
  }
}

async function todayText(ctx: Context, t: T): Promise<string> {
  const locale = localeOf(ctx);
  const region = regionOf(ctx.organization);
  const money = (c: number) => formatMoney(c, locale, region);
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const now = today(ctx.organization.timezone);
  const lines = [`<b>${h(ctx.organization.name)}</b> · ${formatDate(now, locale, region)}`];
  if (can("finance.read")) {
    const s = await financeSummary(ctx, `${now.slice(0, 7)}-01`, now);
    lines.push(
      `${t("dash2.revenue")}: ${money(s.incomeCents - s.refundCents)}`,
      `${t("dash2.expenses")}: ${money(s.expenseCents)}`,
      `${t("dash2.result")}: <b>${money(s.resultCents)}</b>`,
    );
  }
  if (can("invoices.read")) {
    const owed = await invoiceStats(ctx);
    lines.push(`${t("dash2.outstanding")}: ${money(owed.outstandingCents)} (${owed.outstanding})${owed.overdue ? ` · ⚠️ ${t("dash2.overdue", { count: owed.overdue })}` : ""}`);
  }
  if (can("orders.read")) {
    const open = await openOrderStats(ctx);
    lines.push(`${t("dash2.openOrders")}: ${open.count} · ${money(open.netCents)}`);
  }
  return lines.join("\n");
}

async function calendarText(ctx: Context, t: T): Promise<string> {
  if (!ctx.permissions.has("calendar.read")) return t("common.forbidden");
  const tz = ctx.organization.timezone;
  const day = today(tz);
  const items = await listAppointments(ctx, { ...dayBounds(day, tz), userId: ctx.user.userId, activeOnly: true });
  if (!items.length) return t("bot.noAppointments");
  return [
    `<b>${t("bot.appointmentsToday")}</b>`,
    ...items.map((a) => `${localParts(a.startsAt, tz).time}–${localParts(a.endsAt, tz).time} ${h(a.title)}${a.clientName ? ` · ${h(a.clientName)}` : ""}${a.location ? `\n📍 ${h(a.location)}` : ""}`),
  ].join("\n");
}

async function tasksText(ctx: Context, t: T): Promise<string> {
  if (!ctx.permissions.has("tasks.read")) return t("common.forbidden");
  const locale = localeOf(ctx);
  const region = regionOf(ctx.organization);
  const day = today(ctx.organization.timezone);
  const open = await listTasks(ctx, { assignedUserId: ctx.user.userId, open: true });
  if (!open.length) return t("bot.noTasks");
  const base = appUrl();
  const lines = open.slice(0, 15).map((task) => {
    const late = task.dueDate && task.dueDate < day;
    const due = task.dueDate ? ` · ${formatDate(task.dueDate, locale, region)}` : "";
    return `${late ? "⚠️ " : task.priority === "HIGH" ? "❗ " : "• "}${h(task.title)}${due}`;
  });
  return [`<b>${t("bot.myTasks", { count: open.length })}</b>`, ...lines, ...(base ? ["", `<a href="${base}/app/tasks?mine=1">${t("bot.openApp")}</a>`] : [])].join("\n");
}

async function invoicesText(ctx: Context, t: T): Promise<string> {
  if (!ctx.permissions.has("invoices.read")) return t("common.forbidden");
  const locale = localeOf(ctx);
  const region = regionOf(ctx.organization);
  const { rows, total } = await listInvoices(ctx, { filter: "OPEN", pageSize: 10 });
  if (!rows.length) return t("bot.noOpenInvoices");
  const base = appUrl();
  const lines = rows.map((i) => {
    const label = h(`${i.number} · ${i.clientName}`);
    const linked = base ? `<a href="${base}/app/invoices/${i.id}">${label}</a>` : label;
    const due = i.dueDate ? ` · ${formatDate(i.dueDate, locale, region)}` : "";
    return `${i.overdue ? "⚠️ " : ""}${linked}\n${formatMoney(openCents(i), locale, region)}${due}`;
  });
  return [`<b>${t("bot.openInvoices", { count: total })}</b>`, ...lines].join("\n\n");
}

async function clientsText(ctx: Context, t: T, query: string): Promise<string> {
  if (!ctx.permissions.has("clients.read")) return t("common.forbidden");
  const { rows } = await listClients(ctx, { q: query || undefined, pageSize: 10 });
  if (!rows.length) return t("bot.noClients");
  const base = appUrl();
  return rows
    .map((c) => {
      const name = h(`#${c.number} ${displayName(c)}`);
      const contact = [c.phone, c.email, c.city].filter(Boolean).map((v) => h(String(v))).join(" · ");
      return `${base ? `<a href="${base}/app/clients/${c.id}">${name}</a>` : name}${contact ? `\n${contact}` : ""}`;
    })
    .join("\n\n");
}
