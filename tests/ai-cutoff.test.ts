import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiCreate, restFor, wakeGeminiModels, type CreateMessage } from "@/server/ai-provider";
import { generateSite } from "@/server/site-ai";
import { newCompany } from "./helpers";

type Params = Parameters<typeof geminiCreate>[0];
const hello = { model: "gemini-3.6-flash", max_tokens: 10, messages: [{ role: "user", content: "Hallo" }] } as Params;
const sse = (chunks: unknown[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
const reply = (text: string, stop = "end_turn") =>
  ({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text }], stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Anthropic.Beta.BetaMessage;

afterEach(() => {
  vi.unstubAllEnvs();
  wakeGeminiModels();
});

describe("answers Gemini cuts off", () => {
  it("takes a stream that ends without a reason as no answer and asks the next model", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("GEMINI_FALLBACK_MODELS", "gemini-flash-lite-latest");
    const asked: string[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model as string;
      asked.push(model);
      return model === "gemini-3.6-flash" ? sse([{ choices: [{ delta: { content: '{"theme": {"pre' } }] }]) : sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]);
    }) as unknown as typeof fetch;
    const answer = await geminiCreate(hello, fetcher, 0);
    expect(asked).toEqual(["gemini-3.6-flash", "gemini-flash-lite-latest"]);
    expect(answer.content).toMatchObject([{ type: "text", text: "ok" }]);
  });

  it("lets a model out of its daily quota rest until the quota comes back", () => {
    const daily = Anthropic.APIError.generate(
      429,
      { error: { message: "Quota exceeded: requests per day limit exceeded on Free Tier. Please retry in 19h7m35.4s." } },
      "Quota exceeded: requests per day limit exceeded on Free Tier. Please retry in 19h7m35.4s.",
      new Headers(),
    );
    expect(Math.round(restFor(daily))).toBe(68_855_400);
    expect(restFor(Anthropic.APIError.generate(429, undefined, "Too many requests", new Headers()))).toBe(300_000);
    expect(restFor(Anthropic.APIError.generate(503, undefined, "overloaded", new Headers()))).toBe(300_000);
  });

  it("makes the site builder ask once more, and says so when it still cannot read the answer", async () => {
    const ctx = await newCompany("Wieder GmbH");
    const site = { kind: "company" as const, locale: "de", name: "Wieder" };
    const prompt = { prompt: "Eine Firma, die Dinge wiederholt" };
    let calls = 0;
    const good = JSON.stringify({ theme: { preset: "fresh" }, sections: [{ type: "hero", title: "Hallo" }] });
    const flaky: CreateMessage = async () => (calls++ === 0 ? reply('{"theme": {"pre') : reply(good));
    const made = await generateSite(ctx, site, prompt, flaky);
    expect(calls).toBe(2);
    expect(made.sections.map((s) => s.type)).toEqual(["hero"]);
    await expect(generateSite(ctx, site, prompt, async () => reply('{"theme"'))).rejects.toMatchObject({ code: "FAILED" });
    await expect(generateSite(ctx, site, prompt, async () => reply("", "refusal"))).rejects.toMatchObject({ code: "REFUSED" });
  });
});
