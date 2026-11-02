import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { memberships, organizations, telegramLinkTokens } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { assistantMessages } from "@/db/schema";
import { AssistantError, askAssistant, conversation } from "@/server/assistant/run";
import { runTool } from "@/server/assistant/tools";
import { createClient } from "@/server/clients";
import type { Context } from "@/server/context";
import { handleUpdate, type BotIO, type Update } from "@/server/telegram/bot";
import { createLinkToken, linkOfUser, redeemLinkToken } from "@/server/telegram/links";
import { chunks } from "@/server/telegram/api";
import { newCompany, newMember } from "./helpers";

let tg = 1000;
const nextTg = () => String(++tg);

function fakeIO() {
  const sent: { chatId: string; text: string; keyboard?: unknown }[] = [];
  const io: BotIO = {
    send: async (chatId, text, keyboard) => void sent.push({ chatId, text, keyboard }),
    answerCallback: async () => undefined,
    typing: async () => undefined,
  };
  return { io, sent };
}

let updateId = 1;
const message = (from: string, text: string): Update => ({
  update_id: updateId++,
  message: { message_id: 1, chat: { id: Number(from), type: "private" }, from: { id: Number(from), language_code: "de" }, text },
});

async function linked(ctx: Context): Promise<string> {
  const id = nextTg();
  const result = await redeemLinkToken(await createLinkToken(ctx.user.userId, ctx.organization.id), { userId: id, chatId: id, username: "tester" });
  expect(result.ok).toBe(true);
  return id;
}

describe("telegram linking", () => {
  it("redeems a code once, for one account", async () => {
    const ctx = await newCompany("Link GmbH");
    const token = await createLinkToken(ctx.user.userId, ctx.organization.id);
    const id = nextTg();
    expect((await redeemLinkToken(token, { userId: id, chatId: id, username: null })).ok).toBe(true);
    expect(await redeemLinkToken(token, { userId: id, chatId: id, username: null })).toEqual({ ok: false, reason: "invalid" });
    expect((await linkOfUser(ctx.user.userId))?.telegramUserId).toBe(id);

    const other = await newCompany("Andere GmbH");
    expect(await redeemLinkToken(await createLinkToken(other.user.userId, other.organization.id), { userId: id, chatId: id, username: null })).toEqual({
      ok: false,
      reason: "taken",
    });
  });

  it("refuses expired and made-up codes", async () => {
    const ctx = await newCompany("Ablauf GmbH");
    const token = await createLinkToken(ctx.user.userId, ctx.organization.id);
    await getDb().update(telegramLinkTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(telegramLinkTokens.userId, ctx.user.userId));
    const id = nextTg();
    expect((await redeemLinkToken(token, { userId: id, chatId: id, username: null })).ok).toBe(false);
    expect((await redeemLinkToken("x".repeat(32), { userId: id, chatId: id, username: null })).ok).toBe(false);
  });

  it("splits long messages at line breaks", () => {
    const text = Array.from({ length: 300 }, (_, i) => `Zeile ${i} ${"x".repeat(20)}`).join("\n");
    const parts = chunks(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 4000)).toBe(true);
    expect(parts.join("\n")).toBe(text);
  });
});

describe("telegram bot", () => {
  it("links with /start and answers commands for the linked company only", async () => {
    const ctx = await newCompany("Bot GmbH");
    await createClient(ctx, { companyName: "Kunde <script> AG", city: "Mannheim" });
    const id = nextTg();
    const { io, sent } = fakeIO();

    await handleUpdate(message(id, "hallo"), io);
    expect(sent.at(-1)?.text).toContain("Verbinde zuerst");

    await handleUpdate(message(id, `/start ${await createLinkToken(ctx.user.userId, ctx.organization.id)}`), io);
    expect(sent.at(-1)?.text).toContain("Bot GmbH");

    await handleUpdate(message(id, "/clients kunde"), io);
    expect(sent.at(-1)?.text).toContain("Kunde &lt;script&gt; AG");

    await handleUpdate(message(id, "/today"), io);
    expect(sent.at(-1)?.text).toContain("Offene Rechnungen");

    await handleUpdate(message(id, "/invoices"), io);
    expect(sent.at(-1)?.text).toBe("Keine offenen Rechnungen.");
  });

  it("switches between the user's companies, and only those", async () => {
    const ctx = await newCompany("Erste GmbH");
    const [second] = await getDb().insert(organizations).values({ name: "Zweite GmbH" }).returning();
    await getDb().insert(memberships).values({ organizationId: second.id, userId: ctx.user.userId, role: "OWNER" });
    const stranger = await newCompany("Fremde GmbH");
    const id = await linked(ctx);
    const { io, sent } = fakeIO();

    await handleUpdate(message(id, "/company"), io);
    expect(JSON.stringify(sent.at(-1)?.keyboard)).toContain(`co:${second.id}`);

    const press = (data: string): Update => ({ update_id: updateId++, callback_query: { id: "q", from: { id: Number(id) }, data, message: { chat: { id: Number(id) } } } });
    await handleUpdate(press(`co:${stranger.organization.id}`), io);
    expect((await linkOfUser(ctx.user.userId))?.organizationId).toBe(ctx.organization.id);
    await handleUpdate(press(`co:${second.id}`), io);
    expect((await linkOfUser(ctx.user.userId))?.organizationId).toBe(second.id);
    expect(sent.at(-1)?.text).toContain("Zweite GmbH");
  });

  it("keeps an employee's rights in Telegram", async () => {
    const owner = await newCompany("Rechte GmbH");
    const employee = await newMember(owner, "EMPLOYEE");
    const id = await linked(employee);
    const { io, sent } = fakeIO();
    await handleUpdate(message(id, "/today"), io);
    expect(sent.at(-1)?.text).not.toContain("Ergebnis");
  });
});

describe("webhook", () => {
  const saved = process.env.BOT_TOKEN;
  beforeEach(() => {
    process.env.BOT_TOKEN = "123:test";
  });
  afterEach(() => {
    process.env.BOT_TOKEN = saved;
  });

  it("refuses calls without Telegram's secret", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const res = await POST(new Request("http://x/api/telegram/webhook", { method: "POST", body: "{}", headers: { "x-telegram-bot-api-secret-token": "wrong" } }));
    expect(res.status).toBe(401);
  });
});

// --- Assistant -------------------------------------------------------------------------------

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
const reply = (content: unknown[], stop_reason: string) => ({ id: "m", type: "message", role: "assistant", model: "x", content, stop_reason, usage: {} }) as unknown as Anthropic.Beta.BetaMessage;

describe("assistant", () => {
  const saved = process.env.AI_DAILY_LIMIT;
  afterEach(() => {
    process.env.AI_DAILY_LIMIT = saved;
  });

  it("answers from tool results and keeps the conversation", async () => {
    const ctx = await newCompany("Assistent GmbH");
    await createClient(ctx, { companyName: "Sonnenschein KG" });
    const calls: Params[] = [];
    const create = async (params: Params) => {
      calls.push(structuredClone(params));
      if (calls.length === 1) return reply([{ type: "tool_use", id: "t1", name: "search_clients", input: { query: "Sonnen" } }], "tool_use");
      return reply([{ type: "text", text: "Gefunden: Sonnenschein KG" }], "end_turn");
    };
    const answer = await askAssistant(ctx, "web", "Gibt es Sonnenschein?", create);
    expect(answer).toBe("Gefunden: Sonnenschein KG");
    const toolResult = JSON.stringify(calls[1].messages.at(-1));
    expect(toolResult).toContain("Sonnenschein KG");
    expect(calls[0].system).toContain("Assistent GmbH");
    expect((await conversation(ctx, "web")).map((m) => m.role)).toEqual(["user", "assistant"]);

    // The next question carries the earlier exchange.
    await askAssistant(ctx, "web", "Danke", async (params) => {
      expect(params.messages).toHaveLength(3);
      return reply([{ type: "text", text: "Gern" }], "end_turn");
    });
  });

  it("is only for roles with the assistant permission", async () => {
    const owner = await newCompany("Rolle GmbH");
    const custom = await newMember(owner, "CUSTOM", ["clients.read"]);
    await expect(askAssistant(custom, "web", "hallo", async () => reply([{ type: "text", text: "ok" }], "end_turn"))).rejects.toMatchObject({
      permission: "ai.use",
    });
  });

  it("stops at the daily limit and on a refusal", async () => {
    const ctx = await newCompany("Limit GmbH");
    process.env.AI_DAILY_LIMIT = "1";
    await askAssistant(ctx, "web", "eins", async () => reply([{ type: "text", text: "ok" }], "end_turn"));
    await expect(askAssistant(ctx, "web", "zwei", async () => reply([{ type: "text", text: "ok" }], "end_turn"))).rejects.toMatchObject({ code: "LIMIT" });
    process.env.AI_DAILY_LIMIT = "10";
    await expect(askAssistant(ctx, "telegram", "x", async () => reply([], "refusal"))).rejects.toBeInstanceOf(AssistantError);
  });

  it("runs tools with the user's rights and validates input", async () => {
    const owner = await newCompany("Werkzeug GmbH");
    const client = await createClient(owner, { lastName: "Kunde", email: "kunde@example.org" });
    const accountant = await newMember(owner, "ACCOUNTANT");
    const viaOwner = await runTool(owner, "create_invoice_draft", { client_id: client.id, items: [{ description: "Arbeit", quantity: 2, unit_price: 50 }] }, "ai");
    expect(viaOwner.isError).toBe(false);
    expect(JSON.parse(viaOwner.content)).toMatchObject({ status: "DRAFT", net: 100, gross: 119 });

    const denied = await runTool(accountant, "create_client", { last_name: "Neu" }, "ai");
    expect(denied).toEqual({ content: "This user is not allowed to do that.", isError: true });
    expect((await runTool(owner, "get_client", { client_id: "nope" }, "ai")).isError).toBe(true);
    expect((await runTool(owner, "drop_tables", {}, "ai")).isError).toBe(true);

    const dupe = JSON.parse((await runTool(owner, "create_client", { last_name: "Anders", email: "kunde@example.org" }, "ai")).content);
    expect(dupe.created).toBe(false);
  });

  it("keeps each company's conversation to itself", async () => {
    const a = await newCompany("A GmbH");
    const b = await newCompany("B GmbH");
    await askAssistant(a, "web", "geheim", async () => reply([{ type: "text", text: "ok" }], "end_turn"));
    const visible = await withTenant(b.organization.id, (tx) => tx.select().from(assistantMessages));
    expect(visible).toHaveLength(0);
  });
});
