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

export type AiProvider = "anthropic" | "gemini";

/** AI_PROVIDER when set, otherwise Gemini only when its key is the one given. */
export function aiProvider(): AiProvider {
  const chosen = env("AI_PROVIDER").toLowerCase();
  if (chosen === "anthropic" || chosen === "gemini") return chosen;
  return !env("ANTHROPIC_API_KEY") && env("GEMINI_API_KEY") ? "gemini" : "anthropic";
}

/** The setting that holds the key of the chosen service (shown in the Integration Hub). */
export function assistantKeyName(): string {
  return aiProvider() === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
}

export function assistantKey(): string | null {
  return env(assistantKeyName()) || null;
}

/** AI_MODEL when it belongs to the chosen service, so switching services needs only the key. */
export function assistantModel(): string {
  const own = env("AI_MODEL");
  if (aiProvider() === "gemini") return own.startsWith("gemini") ? own : "gemini-3.8-flash";
  return own && !own.startsWith("gemini") ? own : "claude-opus-5-5";
}

/** Tried in turn when the Gemini model is busy or gone (GEMINI_FALLBACK_MODELS, comma separated; "none": no other). */
export function geminiFallbackModels(): string[] {
  return (env("GEMINI_FALLBACK_MODELS") || "gemini-flash-lite-latest")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.startsWith("gemini"));
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

/** YouTube Data API key: public channel figures (subscribers, views, videos). */
export function youtubeKey(): string | null {
  return env("YOUTUBE_API_KEY") || null;
}

/** The operator of this server, for Impressum and privacy policy (LEGAL_* in .env). */
export function legalInfo() {
  const get = (name: string) => env(name) || null;
  return {
    name: get("LEGAL_NAME"),
    address: get("LEGAL_ADDRESS")?.replace(/\n/g, "\n") ?? null,
    email: get("LEGAL_EMAIL"),
    phone: get("LEGAL_PHONE"),
    representative: get("LEGAL_REPRESENTATIVE"),
    register: get("LEGAL_REGISTER"),
    vatId: get("LEGAL_VAT_ID"),
    hosting: get("LEGAL_HOSTING"),
  };
}
