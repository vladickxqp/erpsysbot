import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { assistantMessages, organizations, transactions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { geminiCreate, readStream, wakeGeminiModels } from "@/server/ai-provider";
import { callTool, decideAction } from "@/server/assistant/actions";
import { askAssistantDetailed } from "@/server/assistant/run";
import { newCompany, newMember } from "./helpers";

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.BetaMessage;

afterEach(() => {
  vi.unstubAllEnvs();
  wakeGeminiModels();
});

/** A streamed answer as Gemini sends it, in the given pieces. */
const sse = (chunks: unknown[], cut = 7) => {
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        // Split anywhere, also inside a line: the reader must put it together.
        for (let i = 0; i < bytes.length; i += cut) controller.enqueue(bytes.slice(i, i + cut));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
};

const hello = { model: "gemini-3.8-flash", max_tokens: 10, messages: [{ role: "user", content: "Hallo" }] } as Params;

describe("Gemini's answer as a stream", () => {
  it("puts text, tool calls with Gemini's own data, the stop reason and the usage back together", async () => {
    const body = await readStream(
      sse([
        { id: "r1", model: "gemini-3.6-flash", choices: [{ delta: { content: "Ich " } }] },
        { choices: [{ delta: { content: "schaue nach." } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "list_invoices", arguments: '{"fil' }, extra_content: { google: { thought_signature: "sig" } } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ter":"OPEN"}' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 1, id: "c2", function: { name: "finance_summary", arguments: "{}" } }] }, finish_reason: "tool_calls" }] },
        { choices: [], usage: { prompt_tokens: 120, completion_tokens: 9 } },
      ]),
    );
    expect(body).toMatchObject({
      id: "r1",
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: "Ich schaue nach.",
            tool_calls: [
              { id: "c1", function: { name: "list_invoices", arguments: '{"filter":"OPEN"}' }, extra_content: { google: { thought_signature: "sig" } } },
              { id: "c2", function: { name: "finance_summary", arguments: "{}" } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 9 },
    });
  });

  it("asks for the stream, reads it, and treats an error inside it like any other error", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("GEMINI_FALLBACK_MODELS", "none");
    const bodies: Record<string, unknown>[] = [];
    const answer = await geminiCreate(hello, (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return sse([{ choices: [{ delta: { content: "Hallo zurück" }, finish_reason: "stop" }] }]);
    }) as unknown as typeof fetch, 0);
    expect(answer).toMatchObject({ stop_reason: "end_turn", content: [{ type: "text", text: "Hallo zurück" }] });
    expect(bodies[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    await expect(geminiCreate(hello, (async () => sse([{ error: { code: 503, message: "overloaded" } }])) as unknown as typeof fetch, 0)).rejects.toMatchObject({ status: 503 });
  });

  it("gives up on a model that says nothing, and lets a busy one rest before asking it again", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("GEMINI_FALLBACK_MODELS", "gemini-lite");
    const asked: string[] = [];
    const silent = (async (_url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model as string;
      asked.push(model);
      if (model === "gemini-3.8-flash") {
        // Says nothing until it is given up on.
        return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }
      return sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]);
    }) as unknown as typeof fetch;
    const started = Date.now();
    expect((await geminiCreate(hello, silent, 0, 50)).content).toMatchObject([{ type: "text", text: "ok" }]);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(asked).toEqual(["gemini-3.8-flash", "gemini-lite"]);

    // Resting: the next question goes straight to the model that works.
    asked.length = 0;
    await geminiCreate(hello, silent, 0, 50);
    expect(asked).toEqual(["gemini-lite"]);
    wakeGeminiModels();
    asked.length = 0;
    await geminiCreate(hello, silent, 0, 50);
    expect(asked).toEqual(["gemini-3.8-flash", "gemini-lite"]);
  });
});

describe("receipts and company details through the assistant", () => {
  it("prepares an expense, books it only on the yes, and offers it only to those who may book", async () => {
    const ctx = await newCompany("Beleg GmbH");
    const out = await callTool(ctx, "record_expense", { vendor: "Hetzner", date: "2026-11-10", amount: 23.8, category: "software", description: "Rechnung.pdf" }, "ai");
    expect(out.proposed).toMatchObject({ tool: "record_expense", status: "PROPOSED" });
    const before = await withTenant(ctx.organization.id, (tx) => tx.select().from(transactions));
    expect(before).toEqual([]);
    const done = await decideAction(ctx, out.proposed!.id, true);
    expect(done).toMatchObject({ status: "DONE", result: { booked: true, amount: 23.8, link: "/app/finance" } });
    const [row] = await withTenant(ctx.organization.id, (tx) => tx.select().from(transactions).where(eq(transactions.type, "EXPENSE")));
    expect(row).toMatchObject({ amountCents: 2380, bookedOn: "2026-11-10", category: "software", description: "Hetzner – Rechnung.pdf" });

    const viewer = await newMember(ctx, "VIEWER", ["ai.use"]);
    expect(await callTool(viewer, "record_expense", { vendor: "X", date: "2026-11-10", amount: 1, category: "other" }, "ai")).toMatchObject({ isError: true });
    expect((await callTool(ctx, "record_expense", { vendor: "X", date: "10.11.2026", amount: 1, category: "other" }, "ai")).isError).toBe(true);
  });

  it("changes only the company details given, and nothing before the yes", async () => {
    const ctx = await newCompany("Daten GmbH");
    await getDb().update(organizations).set({ paymentTermsDays: 30, invoiceFooter: "Danke!" }).where(eq(organizations.id, ctx.organization.id));
    const out = await callTool(ctx, "update_company", { street: "Neue Str. 5", postal_code: "50667", city: "Köln", iban: "DE89 3704 0044 0532 0130 00" }, "ai");
    expect(out.proposed?.status).toBe("PROPOSED");
    expect((await getDb().select().from(organizations).where(eq(organizations.id, ctx.organization.id)))[0].street).toBeNull();
    const done = await decideAction(ctx, out.proposed!.id, true);
    expect(done.status).toBe("DONE");
    const [org] = await getDb().select().from(organizations).where(eq(organizations.id, ctx.organization.id));
    expect(org).toMatchObject({ name: "Daten GmbH", street: "Neue Str. 5", postalCode: "50667", city: "Köln", iban: "DE89370400440532013000", paymentTermsDays: 30, invoiceFooter: "Danke!" });
    expect((await callTool(ctx, "update_company", {}, "ai")).isError).toBe(true);
    const employee = await newMember(ctx, "EMPLOYEE", ["ai.use"]);
    expect((await callTool(employee, "update_company", { city: "Bonn" }, "ai")).isError).toBe(true);
  });

  it("hands attached files to the model with their names, keeps the names in the chat, and tells each step", async () => {
    const ctx = await newCompany("Anhang GmbH");
    const seen: Params[] = [];
    const steps: string[] = [];
    const reply = (content: unknown[], stop: string) => ({ id: "m", type: "message", role: "assistant", model: "x", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Message;
    const create = async (p: Params) => {
      seen.push(JSON.parse(JSON.stringify(p)));
      return seen.length === 1
        ? reply([{ type: "tool_use", id: "t1", name: "record_expense", input: { vendor: "Tankstelle", date: "2026-11-11", amount: 61.2, category: "vehicle", description: "beleg.png" } }], "tool_use")
        : reply([{ type: "text", text: "Ich habe die Ausgabe vorbereitet." }], "end_turn");
    };
    const result = await askAssistantDetailed(ctx, "web", "Bitte erfassen", create, {
      attachments: [{ name: "beleg.png", mediaType: "image/png", data: "iVBORw0KGgo=", documentId: "11111111-1111-4111-8111-111111111111" }],
      onStep: (s) => steps.push(s.tool),
    });
    expect(result.answer).toBe("Ich habe die Ausgabe vorbereitet.");
    expect(steps).toEqual(["record_expense"]);
    expect(result.proposals).toMatchObject([{ tool: "record_expense", status: "PROPOSED" }]);
    const first = seen[0].messages.at(-1)!.content as { type: string; text?: string; source?: { media_type: string } }[];
    expect(first[0]).toMatchObject({ type: "image", source: { media_type: "image/png" } });
    expect(first[1].text).toContain('Attached files: 1. "beleg.png" (saved as document_id 11111111-1111-4111-8111-111111111111)');
    const [stored] = await withTenant(ctx.organization.id, (tx) => tx.select().from(assistantMessages).where(and(eq(assistantMessages.role, "user"), eq(assistantMessages.conversationId, result.conversationId!))));
    expect(stored.content).toBe("Bitte erfassen\n📎 beleg.png");

    // Files alone are a question too.
    const alone = await askAssistantDetailed(ctx, "web", "", async () => reply([{ type: "text", text: "Gelesen." }], "end_turn"), { attachments: [{ name: "x.pdf", mediaType: "application/pdf", data: "JVBERi0=" }] });
    expect(alone.answer).toBe("Gelesen.");
  });
});
