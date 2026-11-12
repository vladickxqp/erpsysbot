import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromChat, geminiCreate, toChat } from "@/server/ai-provider";
import { askAssistantDetailed } from "@/server/assistant/run";
import { createClient } from "@/server/clients";
import { integrationStates } from "@/server/integrations";
import { aiProvider, assistantKey, assistantModel } from "@/server/settings";
import { newCompany } from "./helpers";

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

afterEach(() => {
  vi.unstubAllEnvs();
});

const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
const hello = { model: "gemini-3.8-flash", max_tokens: 10, messages: [{ role: "user", content: "Hallo" }] } as Params;

describe("choosing the AI service", () => {
  it("takes Gemini when only its key is set or when chosen, with a model of its own", () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("AI_MODEL", "claude-opus-5-5");
    expect([aiProvider(), assistantKey(), assistantModel()]).toEqual(["gemini", "g-key", "gemini-3.8-flash"]);
    expect(integrationStates().find((i) => i.key === "assistant")).toEqual({ key: "assistant", state: "ready" });

    vi.stubEnv("ANTHROPIC_API_KEY", "a-key");
    expect([aiProvider(), assistantKey(), assistantModel()]).toEqual(["anthropic", "a-key", "claude-opus-5-5"]);

    vi.stubEnv("AI_PROVIDER", "Gemini");
    vi.stubEnv("AI_MODEL", "gemini-3.8-pro");
    expect([aiProvider(), assistantKey(), assistantModel()]).toEqual(["gemini", "g-key", "gemini-3.8-pro"]);

    vi.stubEnv("GEMINI_API_KEY", "");
    expect(assistantKey()).toBeNull();
    expect(integrationStates().find((i) => i.key === "assistant")).toEqual({ key: "assistant", state: "setup", env: "GEMINI_API_KEY" });
  });
});

describe("speaking Gemini's format", () => {
  it("turns a request with tools, a tool result carrying a picture and a schema into chat messages", () => {
    const params = {
      model: "gemini-3.8-flash",
      max_tokens: 100,
      system: "Sys",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: { type: "object" } } },
      tools: [{ name: "get_client", description: "Read", input_schema: { type: "object", properties: { id: { type: "string" } } } }],
      messages: [
        { role: "user", content: "Hallo" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "x", signature: "s" },
            { type: "text", text: "Moment" },
            { type: "tool_use", id: "c1", name: "get_client", input: { id: "7" }, geminiExtra: { google: { thought_signature: "sig" } } },
          ],
        },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }] }] },
        { role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "PDF" } }, { type: "text", text: "Lies das" }] },
      ],
    } as unknown as Params;
    expect(toChat(params)).toEqual({
      model: "gemini-3.8-flash",
      max_tokens: 100,
      reasoning_effort: "medium",
      messages: [
        { role: "system", content: "Sys" },
        { role: "user", content: "Hallo" },
        {
          role: "assistant",
          content: "Moment",
          tool_calls: [{ id: "c1", type: "function", function: { name: "get_client", arguments: '{"id":"7"}' }, extra_content: { google: { thought_signature: "sig" } } }],
        },
        { role: "tool", tool_call_id: "c1", content: "The file follows in the next message." },
        { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }] },
        { role: "user", content: [{ type: "image_url", image_url: { url: "data:application/pdf;base64,PDF" } }, { type: "text", text: "Lies das" }] },
      ],
      tools: [{ type: "function", function: { name: "get_client", description: "Read", parameters: { type: "object", properties: { id: { type: "string" } } } } }],
      response_format: { type: "json_schema", json_schema: { name: "result", schema: { type: "object" } } },
    });
  });

  it("reads tool calls, text, the stop reason and the usage back", () => {
    const call = fromChat(
      {
        id: "r",
        choices: [{ finish_reason: "stop", message: { content: null, tool_calls: [{ id: "c9", type: "function", function: { name: "search_clients", arguments: '{"query":"Neu"}' }, extra_content: { google: { thought_signature: "s2" } } }] } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      },
      "m",
    );
    expect(call).toMatchObject({
      stop_reason: "tool_use",
      usage: { input_tokens: 12, output_tokens: 3 },
      content: [{ type: "tool_use", id: "c9", name: "search_clients", input: { query: "Neu" }, geminiExtra: { google: { thought_signature: "s2" } } }],
    });
    expect(fromChat({ choices: [{ finish_reason: "stop", message: { content: "Hallo" } }] }, "m")).toMatchObject({ stop_reason: "end_turn", content: [{ type: "text", text: "Hallo" }] });
    expect(fromChat({ choices: [{ finish_reason: "length", message: { content: "Hal" } }] }, "m").stop_reason).toBe("max_tokens");
    expect(fromChat({ choices: [{ finish_reason: "content_filter", message: { content: null } }] }, "m").stop_reason).toBe("refusal");
  });

  it("sends the key only to Gemini and reports its errors like the other service", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    const sent: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Hallo zurück" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect((await geminiCreate(hello, fake)).content).toMatchObject([{ type: "text", text: "Hallo zurück" }]);
    expect(sent[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect((sent[0].init.headers as Record<string, string>).authorization).toBe("Bearer g-key");

    await expect(geminiCreate(hello, respond(400, [{ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }]))).rejects.toBeInstanceOf(Anthropic.AuthenticationError);
    await expect(geminiCreate(hello, respond(429, { error: { message: "Resource has been exhausted" } }))).rejects.toBeInstanceOf(Anthropic.RateLimitError);
    await expect(geminiCreate(hello, respond(503, { error: { message: "overloaded" } }))).rejects.toBeInstanceOf(Anthropic.InternalServerError);
    await expect(geminiCreate(hello, respond(400, { error: { message: "bad schema" } }))).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(geminiCreate(hello, offline)).rejects.toBeInstanceOf(Anthropic.APIConnectionError);
  });

  it("runs the assistant through Gemini: a tool call, its result, the answer", async () => {
    const ctx = await newCompany("Gemini GmbH");
    await createClient(ctx, { lastName: "Neumann" });
    const bodies: { messages: { role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string }[]; tools?: unknown[] }[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const reply =
        bodies.length === 1
          ? {
              choices: [
                {
                  finish_reason: "tool_calls",
                  message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "search_clients", arguments: '{"query":"Neumann"}' }, extra_content: { google: { thought_signature: "sig" } } }] },
                },
              ],
              usage: { prompt_tokens: 5, completion_tokens: 2 },
            }
          : { choices: [{ finish_reason: "stop", message: { content: "Neumann ist Kunde." } }] };
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await askAssistantDetailed(ctx, "web", "Ist Neumann Kunde?", (p) => geminiCreate(p, fake));
    expect(result.answer).toBe("Neumann ist Kunde.");
    expect(result.tools).toEqual(["search_clients"]);
    expect(bodies[0].tools?.length).toBeGreaterThan(5);
    const second = bodies[1].messages;
    expect(second.at(-2)).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1", extra_content: { google: { thought_signature: "sig" } } }] });
    expect(second.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(String(second.at(-1)?.content)).toContain("Neumann");
  });
});
