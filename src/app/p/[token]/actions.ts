"use server";

import { NotFoundError } from "@/server/clients";
import { answerSharedQuote, ShareError } from "@/server/share";

/** No account here: the secret link itself is the right to answer. */
export async function answerQuoteAction(token: string, accept: boolean): Promise<{ ok: boolean }> {
  try {
    await answerSharedQuote(token, accept);
    return { ok: true };
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ShareError) return { ok: false };
    throw e;
  }
}
