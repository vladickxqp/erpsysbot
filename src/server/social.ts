/**
 * Social channels of a company and their figures.
 *
 * Figures come only from the provider's own API — none are typed in, none
 * are estimated. Two providers work today without an app review:
 *
 * - YouTube (YOUTUBE_API_KEY): subscribers, views and videos of any public channel;
 * - Telegram (BOT_TOKEN): members of a channel the bot can see; the bot must be
 *   an administrator of the channel to publish there.
 *
 * Instagram, TikTok, Facebook, LinkedIn and X need an approved developer app
 * with OAuth per company; they are listed as not available until that exists.
 */
import { and, asc, eq, gte, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contentItems, documents, socialAccounts, socialStats, telegramLinks } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import { postText } from "./content";
import type { Context } from "./context";
import { locateDocument } from "./documents";
import { today } from "./money";
import { requirePermission } from "./permissions";
import { botToken, youtubeKey } from "./settings";
import { callTelegram } from "./telegram/api";

export const SOCIAL_PROVIDERS = ["YOUTUBE", "TELEGRAM", "INSTAGRAM", "TIKTOK", "FACEBOOK", "LINKEDIN", "X"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
/** The providers this app can read today. */
export const READABLE: readonly SocialProvider[] = ["YOUTUBE", "TELEGRAM"];

export class SocialError extends Error {
  constructor(
    public readonly code: "NOT_CONFIGURED" | "NOT_SUPPORTED" | "NOT_FOUND" | "FAILED" | "DUPLICATE" | "NOT_TELEGRAM" | "EMPTY" | "LINK_TELEGRAM" | "NOT_CHANNEL_ADMIN" | "TAKEN",
  ) {
    super(code);
  }
}

export function providerReady(provider: string): boolean {
  if (provider === "YOUTUBE") return youtubeKey() !== null;
  if (provider === "TELEGRAM") return botToken() !== null;
  return false;
}

export type Figures = { name: string; url: string | null; externalId: string; followers: number | null; views: number | null; posts: number | null };

type Fetch = typeof fetch;

async function youtube(id: string, fetcher: Fetch): Promise<Figures> {
  const key = youtubeKey();
  if (!key) throw new SocialError("NOT_CONFIGURED");
  const by = id.startsWith("@") ? `forHandle=${encodeURIComponent(id)}` : `id=${encodeURIComponent(id)}`;
  const res = await fetcher(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&${by}&key=${encodeURIComponent(key)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new SocialError(res.status === 400 || res.status === 403 ? "NOT_CONFIGURED" : "FAILED");
  const body = (await res.json()) as {
    items?: { id: string; snippet?: { title?: string; customUrl?: string }; statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean } }[];
  };
  const channel = body.items?.[0];
  if (!channel) throw new SocialError("NOT_FOUND");
  const num = (v?: string) => (v === undefined || v === "" ? null : Number(v));
  return {
    name: channel.snippet?.title ?? id,
    url: `https://www.youtube.com/${channel.snippet?.customUrl ?? `channel/${channel.id}`}`,
    externalId: channel.id,
    followers: channel.statistics?.hiddenSubscriberCount ? null : num(channel.statistics?.subscriberCount),
    views: num(channel.statistics?.viewCount),
    posts: num(channel.statistics?.videoCount),
  };
}

type TelegramCall = <T>(method: string, payload: Record<string, unknown>) => Promise<T>;

async function telegram(id: string, call: TelegramCall = callTelegram): Promise<Figures> {
  if (!botToken()) throw new SocialError("NOT_CONFIGURED");
  try {
    const chat = await call<{ id: number; title?: string; username?: string; type: string }>("getChat", { chat_id: id });
    if (chat.type !== "channel" && chat.type !== "supergroup") throw new SocialError("NOT_FOUND");
    const members = await call<number>("getChatMemberCount", { chat_id: id });
    return {
      name: chat.title ?? id,
      url: chat.username ? `https://t.me/${chat.username}` : null,
      externalId: chat.username ? `@${chat.username}` : String(chat.id),
      followers: members,
      views: null,
      posts: null,
    };
  } catch (e) {
    if (e instanceof SocialError) throw e;
    throw new SocialError("NOT_FOUND");
  }
}

/** The provider's current figures for a channel. */
export async function fetchFigures(provider: string, externalId: string, fetcher: Fetch = fetch, call: TelegramCall = callTelegram): Promise<Figures> {
  if (provider === "YOUTUBE") return youtube(externalId, fetcher);
  if (provider === "TELEGRAM") return telegram(externalId, call);
  throw new SocialError("NOT_SUPPORTED");
}

/** "https://youtube.com/@name", "@name", "UC…", "t.me/channel", "-100…" → what the API takes. */
export function normalizeExternalId(provider: string, value: string): string {
  const v = value.trim();
  if (provider === "YOUTUBE") {
    const m = v.match(/youtube\.com\/(?:channel\/(UC[\w-]{22})|(@[\w.-]+))/i);
    if (m) return m[1] ?? m[2];
    if (/^UC[\w-]{22}$/.test(v)) return v;
    return v.startsWith("@") ? v : `@${v}`;
  }
  if (provider === "TELEGRAM") {
    const m = v.match(/t\.me\/([\w]{5,32})/i);
    if (m) return `@${m[1]}`;
    if (/^-100\d{5,}$/.test(v)) return v;
    return v.startsWith("@") ? v : `@${v}`;
  }
  return v;
}

async function storeFigures(organizationId: string, accountId: string, timezone: string, figures: Figures) {
  await withTenant(organizationId, async (tx) => {
    await tx
      .insert(socialStats)
      .values({ organizationId, accountId, day: today(timezone), followers: figures.followers, views: figures.views, posts: figures.posts })
      .onConflictDoUpdate({
        target: [socialStats.accountId, socialStats.day],
        set: { followers: figures.followers, views: figures.views, posts: figures.posts, createdAt: new Date() },
      });
    await tx.update(socialAccounts).set({ lastFetchedAt: new Date(), lastError: null, name: figures.name, url: figures.url }).where(eq(socialAccounts.id, accountId));
  });
}

/**
 * A Telegram channel is the company's only when the person connecting it
 * administers it in Telegram (through their linked Telegram account), and no
 * other company has it: the bot is shared, so otherwise anyone could post
 * into anyone's channel.
 */
async function checkTelegramOwner(ctx: Context, channel: string, call: TelegramCall): Promise<void> {
  const [link] = await getDb().select({ telegramUserId: telegramLinks.telegramUserId }).from(telegramLinks).where(eq(telegramLinks.userId, ctx.user.userId));
  if (!link) throw new SocialError("LINK_TELEGRAM");
  const member = await call<{ status: string }>("getChatMember", { chat_id: channel, user_id: Number(link.telegramUserId) }).catch(() => null);
  if (!member || !["creator", "administrator"].includes(member.status)) throw new SocialError("NOT_CHANNEL_ADMIN");
}

export async function addSocialAccount(ctx: Context, provider: string, value: string, fetcher: Fetch = fetch, call: TelegramCall = callTelegram) {
  requirePermission(ctx.permissions, "settings.manage");
  if (!(READABLE as readonly string[]).includes(provider)) throw new SocialError("NOT_SUPPORTED");
  if (!value.trim()) throw new SocialError("NOT_FOUND");
  const figures = await fetchFigures(provider, normalizeExternalId(provider, value), fetcher, call);
  if (provider === "TELEGRAM") {
    const [elsewhere] = await getDb()
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(and(eq(socialAccounts.provider, "TELEGRAM"), eq(socialAccounts.externalId, figures.externalId), ne(socialAccounts.organizationId, ctx.organization.id)));
    if (elsewhere) throw new SocialError("TAKEN");
    await checkTelegramOwner(ctx, figures.externalId, call);
  }
  const account = await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .insert(socialAccounts)
      .values({ organizationId: ctx.organization.id, provider, name: figures.name, externalId: figures.externalId, url: figures.url })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new SocialError("DUPLICATE");
    await audit(tx, ctx, "social.connect", "social_account", row.id, { provider, name: row.name });
    return row;
  });
  await storeFigures(ctx.organization.id, account.id, ctx.organization.timezone, figures);
  return account;
}

export async function removeSocialAccount(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "settings.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(socialAccounts).where(eq(socialAccounts.id, id)).returning({ name: socialAccounts.name });
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "social.disconnect", "social_account", id, { name: row.name });
  });
}

const FRESH_MS = 10 * 60_000;

/** Fetches every channel of the company not fetched in the last ten minutes; returns how many failed. */
export async function refreshSocial(ctx: Context, fetcher: Fetch = fetch): Promise<number> {
  requirePermission(ctx.permissions, "content.read");
  const accounts = await withTenant(ctx.organization.id, (tx) => tx.select().from(socialAccounts));
  return refreshAccounts(ctx.organization.id, ctx.organization.timezone, accounts, fetcher);
}

async function refreshAccounts(organizationId: string, timezone: string, accounts: (typeof socialAccounts.$inferSelect)[], fetcher: Fetch): Promise<number> {
  let failed = 0;
  for (const a of accounts) {
    if (a.lastFetchedAt && Date.now() - a.lastFetchedAt.getTime() < FRESH_MS) continue;
    try {
      await storeFigures(organizationId, a.id, timezone, await fetchFigures(a.provider, a.externalId, fetcher));
    } catch (e) {
      failed++;
      const code = e instanceof SocialError ? e.code : "FAILED";
      await withTenant(organizationId, (tx) => tx.update(socialAccounts).set({ lastFetchedAt: new Date(), lastError: code }).where(eq(socialAccounts.id, a.id)));
    }
  }
  return failed;
}

/** Once a day for every company, so the history has a point per day. */
export async function refreshAllSocial(fetcher: Fetch = fetch): Promise<void> {
  const rows = await getDb()
    .select({ account: socialAccounts, timezone: sql<string>`(select timezone from organizations o where o.id = ${socialAccounts.organizationId})` })
    .from(socialAccounts)
    .where(sql`not exists (select 1 from organizations o where o.id = ${socialAccounts.organizationId} and 'social' = any(o.disabled_modules))`);
  const byOrg = new Map<string, { timezone: string; accounts: (typeof socialAccounts.$inferSelect)[] }>();
  for (const r of rows) {
    const entry = byOrg.get(r.account.organizationId) ?? { timezone: r.timezone, accounts: [] };
    entry.accounts.push(r.account);
    byOrg.set(r.account.organizationId, entry);
  }
  for (const [org, { timezone, accounts }] of byOrg) {
    const stale = accounts.filter((a) => !a.lastFetchedAt || today(timezone, a.lastFetchedAt) !== today(timezone));
    await refreshAccounts(org, timezone, stale, fetcher).catch((e) => console.error("social: refresh failed", e instanceof Error ? e.message : e));
  }
}

let timer: NodeJS.Timeout | null = null;
export function startSocialTimer(): void {
  if (timer || (!youtubeKey() && !botToken())) return;
  timer = setInterval(() => void refreshAllSocial().catch(() => undefined), 60 * 60_000);
  timer.unref?.();
}

export type ChannelOverview = {
  id: string;
  provider: string;
  name: string;
  url: string | null;
  lastFetchedAt: string | null;
  lastError: string | null;
  followers: number | null;
  views: number | null;
  posts: number | null;
  /** Change against the oldest point of the last 30 days. */
  followersDelta: number | null;
  viewsDelta: number | null;
  history: { day: string; followers: number | null; views: number | null }[];
};

/** Every channel with its latest figures and 30 days of history. */
export async function socialOverview(ctx: Context): Promise<ChannelOverview[]> {
  requirePermission(ctx.permissions, "content.read");
  const since = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
  return withTenant(ctx.organization.id, async (tx) => {
    const accounts = await tx.select().from(socialAccounts).orderBy(asc(socialAccounts.provider), asc(socialAccounts.name));
    const stats = await tx.select().from(socialStats).where(gte(socialStats.day, since)).orderBy(asc(socialStats.day));
    return accounts.map((a) => {
      const history = stats.filter((s) => s.accountId === a.id);
      const last = history.at(-1);
      const first = history[0];
      const delta = (k: "followers" | "views") => (last && first && last !== first && last[k] !== null && first[k] !== null ? Number(last[k]) - Number(first[k]) : null);
      return {
        id: a.id,
        provider: a.provider,
        name: a.name,
        url: a.url,
        lastFetchedAt: a.lastFetchedAt?.toISOString() ?? null,
        lastError: a.lastError,
        followers: last?.followers ?? null,
        views: last?.views === null || last?.views === undefined ? null : Number(last.views),
        posts: last?.posts ?? null,
        followersDelta: delta("followers"),
        viewsDelta: delta("views"),
        history: history.map((s) => ({ day: s.day, followers: s.followers, views: s.views === null ? null : Number(s.views) })),
      };
    });
  });
}

/** Telegram channels the company connected: where content can be sent. */
export async function publishTargets(ctx: Context) {
  requirePermission(ctx.permissions, "content.read");
  if (!botToken()) return [];
  return withTenant(ctx.organization.id, (tx) =>
    tx.select({ id: socialAccounts.id, name: socialAccounts.name }).from(socialAccounts).where(eq(socialAccounts.provider, "TELEGRAM")).orderBy(asc(socialAccounts.name)),
  );
}

type TelegramSend = (method: string, payload: Record<string, unknown> | FormData) => Promise<{ message_id: number }>;

const defaultSend: TelegramSend = async (method, payload) => {
  if (!(payload instanceof FormData)) return callTelegram<{ message_id: number }>(method, payload);
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, { method: "POST", body: payload, signal: AbortSignal.timeout(60_000) });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id: number }; description?: string } | null;
  if (!body?.ok || !body.result) throw new Error(`${method}: ${body?.description ?? res.status}`);
  return body.result;
};

/**
 * Sends a content item to a connected Telegram channel — only when a person
 * with content.publish presses the button — and marks it published.
 */
export async function publishToTelegram(ctx: Context, contentId: string, accountId: string, send: TelegramSend = defaultSend): Promise<string | null> {
  requirePermission(ctx.permissions, "content.publish");
  if (!botToken() && send === defaultSend) throw new SocialError("NOT_CONFIGURED");
  const { item, account, image } = await withTenant(ctx.organization.id, async (tx) => {
    const [item] = await tx.select().from(contentItems).where(eq(contentItems.id, contentId)).limit(1);
    const [account] = await tx.select().from(socialAccounts).where(eq(socialAccounts.id, accountId)).limit(1);
    if (!item || !account) throw new NotFoundError();
    if (account.provider !== "TELEGRAM") throw new SocialError("NOT_TELEGRAM");
    const [image] = item.mediaIds.length
      ? await tx
          .select({ id: documents.id, mimeType: documents.mimeType, name: documents.name })
          .from(documents)
          .where(and(eq(documents.id, item.mediaIds[0]), sql`${documents.mimeType} in ('image/jpeg', 'image/png', 'image/webp')`))
      : [];
    return { item, account, image };
  });
  const text = postText(item);
  if (!text && !image) throw new SocialError("EMPTY");

  let messageId: number;
  try {
    if (image) {
      const { file } = await locateDocument(ctx, image.id);
      const { readFile } = await import("node:fs/promises");
      const form = new FormData();
      form.set("chat_id", account.externalId);
      form.set("photo", new Blob([new Uint8Array(await readFile(file))], { type: image.mimeType }), image.name);
      // A photo caption takes 1024 characters; a longer text follows as its own message.
      if (text.length <= 1024) form.set("caption", text);
      messageId = (await send("sendPhoto", form)).message_id;
      if (text.length > 1024) messageId = (await send("sendMessage", { chat_id: account.externalId, text: text.slice(0, 4096) })).message_id;
    } else {
      messageId = (await send("sendMessage", { chat_id: account.externalId, text: text.slice(0, 4096) })).message_id;
    }
  } catch (e) {
    console.error("social: telegram publish failed", e instanceof Error ? e.message : e);
    throw new SocialError("FAILED");
  }

  const url = account.externalId.startsWith("@") ? `https://t.me/${account.externalId.slice(1)}/${messageId}` : null;
  await withTenant(ctx.organization.id, async (tx) => {
    await tx
      .update(contentItems)
      .set({ status: "PUBLISHED", publishedAt: new Date(), socialAccountId: account.id, externalUrl: url, updatedAt: new Date() })
      .where(eq(contentItems.id, item.id));
    await audit(tx, ctx, "content.publish", "content", item.id, { channel: account.name, url });
  });
  return url;
}

/** For the dashboard: totals over all channels and how they moved in 30 days. */
export async function socialTotals(ctx: Context) {
  const channels = await socialOverview(ctx);
  const sum = (k: "followers" | "views" | "followersDelta" | "viewsDelta") => {
    const values = channels.map((c) => c[k]).filter((v): v is number => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  return { channels, followers: sum("followers"), views: sum("views"), followersDelta: sum("followersDelta"), viewsDelta: sum("viewsDelta") };
}
