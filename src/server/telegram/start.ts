/**
 * Connects the bot at server start, when BOT_TOKEN and the public address are
 * set. A failure is logged and the app still starts.
 */
import { LOCALES } from "@/i18n";
import { appUrl, botToken } from "../settings";
import { registerWebhook } from "./api";
import { commandList } from "./bot";

export async function startTelegram(): Promise<void> {
  if (!botToken()) return;
  if (!appUrl()) {
    console.warn("telegram: BOT_TOKEN is set but APP_URL is not — webhook not registered");
    return;
  }
  try {
    await registerWebhook({
      default: commandList("de"),
      ...Object.fromEntries(LOCALES.map((l) => [l, commandList(l)])),
    });
    console.log("telegram: webhook registered");
  } catch (e) {
    console.error("telegram: webhook registration failed", e instanceof Error ? e.message : e);
  }
}
