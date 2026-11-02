/**
 * Settings that come from the environment. The names are the ones the old
 * bot's .env already uses (BOT_TOKEN, ANTHROPIC_API_KEY, AI_MODEL, WEBAPP_URL),
 * so those lines can be copied over unchanged.
 */
import { createHmac } from "node:crypto";

/** Values pasted with quotes or stray spaces still work. */
function env(name: string): string {
  return (process.env[name] ?? "").trim().replace(/^(['"])(.*)\1$/, "$2").trim();
}

export function botToken(): string | null {
  return env("BOT_TOKEN") || null;
}

/** https://host without a trailing slash: APP_URL, else the origin of the old WEBAPP_URL. */
export function appUrl(): string | null {
  for (const name of ["APP_URL", "WEBAPP_URL"]) {
    const value = env(name);
    if (!value) continue;
    try {
      return new URL(value).origin;
    } catch {
      // not a URL: try the next one
    }
  }
  return null;
}

/** Telegram sends this back on every webhook call; derived from the token unless set. */
export function webhookSecret(): string | null {
  const own = env("TELEGRAM_WEBHOOK_SECRET");
  if (own) return own;
  const token = botToken();
  return token ? createHmac("sha256", token).update("telegram-webhook").digest("hex") : null;
}

export function assistantKey(): string | null {
  return env("ANTHROPIC_API_KEY") || null;
}

export function assistantModel(): string {
  return env("AI_MODEL") || "claude-opus-5-5";
}

/** Messages per person and day, across web and Telegram. */
export function assistantDailyLimit(): number {
  const n = Number(env("AI_DAILY_LIMIT"));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100;
}

/** Questions to the assistant per day across the whole server (all companies). */
export function assistantServerDailyLimit(): number {
  const n = Number(env("AI_SERVER_DAILY_LIMIT"));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

/**
 * Who may sign up: "invite" (default) — only with an invitation, except the
 * very first account on an empty server; "open" — anyone.
 */
export function registrationOpen(): boolean {
  return env("REGISTRATION").toLowerCase() === "open";
}

export function smtp(): { host: string; port: number; user: string; password: string } | null {
  const host = env("SMTP_HOST");
  if (!host) return null;
  const port = Number(env("SMTP_PORT")) || 587;
  return { host, port, user: env("SMTP_USER"), password: env("SMTP_PASSWORD") };
}

export function mailFrom(): string | null {
  return env("SMTP_FROM") || null;
}
