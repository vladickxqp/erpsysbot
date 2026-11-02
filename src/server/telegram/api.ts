/**
 * The few Telegram Bot API calls the app makes. Plain HTTPS, no library.
 */
import { appUrl, botToken, webhookSecret } from "../settings";

export class TelegramError extends Error {}

export async function callTelegram<T = unknown>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const token = botToken();
  if (!token) throw new TelegramError("BOT_TOKEN is not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!body?.ok) throw new TelegramError(`${method}: ${body?.description ?? res.status}`);
  return body.result as T;
}

let username: Promise<string | null> | null = null;

/** The bot's @name, for t.me links. Asked once per process. */
export function botUsername(): Promise<string | null> {
  username ??= callTelegram<{ username?: string }>("getMe")
    .then((me) => me.username ?? null)
    .catch(() => {
      username = null;
      return null;
    });
  return username;
}

/** Splits long text at line breaks: Telegram takes at most 4096 characters. */
export function chunks(text: string, size = 4000): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    const cut = rest.lastIndexOf("\n", size);
    const at = cut > size / 2 ? cut : size;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out;
}

export type Keyboard = { text: string; callback_data?: string; url?: string }[][];

export async function sendMessage(chatId: string, html: string, keyboard?: Keyboard): Promise<void> {
  const parts = chunks(html);
  for (const [i, part] of parts.entries()) {
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: part,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(keyboard && i === parts.length - 1 ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }
}

export const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Points Telegram at this app. Runs at server start when BOT_TOKEN and the
 * public address are known; replaces the old bot's polling.
 */
export async function registerWebhook(commands: Record<string, { command: string; description: string }[]>): Promise<void> {
  const base = appUrl();
  const secret = webhookSecret();
  if (!botToken() || !base || !secret) return;
  await callTelegram("setWebhook", {
    url: `${base}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  });
  for (const [language, list] of Object.entries(commands)) {
    await callTelegram("setMyCommands", { commands: list, ...(language === "default" ? {} : { language_code: language }) });
  }
}
