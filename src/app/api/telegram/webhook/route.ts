import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { handleUpdate, type Update } from "@/server/telegram/bot";
import { webhookSecret } from "@/server/settings";

export const runtime = "nodejs";

/** Telegram resends an update it thinks failed; each is handled once. */
const seen = new Set<number>();

function sameSecret(given: string | null): boolean {
  const expected = webhookSecret();
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = (await request.json().catch(() => null)) as Update | null;
  if (!update || typeof update.update_id !== "number") return NextResponse.json({ ok: true });
  if (seen.has(update.update_id)) return NextResponse.json({ ok: true });
  seen.add(update.update_id);
  if (seen.size > 5000) seen.delete(seen.values().next().value!);

  // Answer Telegram at once; the assistant may take a while.
  after(async () => {
    try {
      await handleUpdate(update);
    } catch (e) {
      console.error("telegram: update failed", e);
    }
  });
  return NextResponse.json({ ok: true });
}
