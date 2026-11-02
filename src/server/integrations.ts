/**
 * What this server is connected to, for the Integration Hub. Only the state
 * is reported (set up or not) — never a key or a token.
 */
import { assistantAvailable } from "./assistant/run";
import { mailAvailable } from "./mail";
import { botToken, youtubeKey } from "./settings";
import { READABLE, SOCIAL_PROVIDERS, type SocialProvider } from "./social";

export type IntegrationKey = "assistant" | "telegramBot" | "mail" | SocialProvider;

export type IntegrationState = {
  key: IntegrationKey;
  /** ready: works; setup: the server needs a setting (named in `env`); unavailable: not offered yet. */
  state: "ready" | "setup" | "unavailable";
  env?: string;
  /** Social providers the company can connect channels of. */
  channels?: boolean;
};

export function integrationStates(): IntegrationState[] {
  const env = (ok: boolean, name: string): Pick<IntegrationState, "state" | "env"> => (ok ? { state: "ready" } : { state: "setup", env: name });
  return [
    { key: "assistant", ...env(assistantAvailable(), "ANTHROPIC_API_KEY") },
    { key: "telegramBot", ...env(botToken() !== null, "BOT_TOKEN") },
    { key: "mail", ...env(mailAvailable(), "SMTP_HOST") },
    ...SOCIAL_PROVIDERS.map((p): IntegrationState => {
      if (!(READABLE as readonly string[]).includes(p)) return { key: p, state: "unavailable" };
      const ready = p === "YOUTUBE" ? youtubeKey() !== null : botToken() !== null;
      return { key: p, ...env(ready, p === "YOUTUBE" ? "YOUTUBE_API_KEY" : "BOT_TOKEN"), channels: true };
    }),
  ];
}
