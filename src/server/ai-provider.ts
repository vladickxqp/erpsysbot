/**
 * Which AI service answers: Anthropic or Google Gemini (AI_PROVIDER, or the
 * one whose key is set). The app speaks one message format everywhere; for
 * Gemini it is translated to Gemini's OpenAI-compatible interface and back,
 * so the assistant, the content generator and the receipt reader stay the same.
 * Errors come back as the SDK's own error classes, so the callers' handling
 * (not configured, busy, failed) works for both. A Gemini model that is busy,
 * over its limit or gone hands the request to the next one (GEMINI_FALLBACK_MODELS).
 */
import Anthropic from "@anthropic-ai/sdk";
import { aiProvider, assistantKey, geminiFallbackModels } from "./settings";

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.BetaMessage;
export type CreateMessage = (params: Params) => Promise<Message>;

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const TIMEOUT_MS = 180_000;
/** While another model is left to try, a model that does not answer gets less time. */
const ATTEMPT_MS = 60_000;
/** Busy, over its limit, gone or failing: worth trying the next model. */
const NEXT_MODEL = new Set([404, 429, 500, 502, 503, 504]);
/** Gemini's own data on a tool call (its thought signature): kept on the block and sent back unchanged. */
export const GEMINI_EXTRA = "geminiExtra";
/** The model that made that signature: another model gets the neutral one Gemini accepts instead. */
export const GEMINI_MODEL = "geminiModel";
const NEUTRAL_SIGNATURE = { google: { thought_signature: "skip_thought_signature_validator" } };

let anthropic: Anthropic | null = null;

export const createMessage: CreateMessage = (params) => {
  if (aiProvider() === "gemini") return geminiCreate(params);
  anthropic ??= new Anthropic({ apiKey: assistantKey() ?? undefined, timeout: TIMEOUT_MS });
  return anthropic.beta.messages.create(params);
};

type Block = { type: string; [key: string]: unknown };
type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: unknown; tool_calls?: unknown[]; tool_call_id?: string };

const dataUrl = (source: unknown): string | null => {
  const s = source as { type?: string; media_type?: string; data?: string } | undefined;
  return s?.type === "base64" && s.media_type && s.data ? `data:${s.media_type};base64,${s.data}` : null;
};

const textOf = (blocks: Block[]) =>
  blocks
    .filter((b) => b.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("\n");

/** Pictures and PDFs as inline data; text as text. */
function parts(blocks: Block[]): unknown[] {
  const out: unknown[] = [];
  for (const b of blocks) {
    if (b.type === "text") out.push({ type: "text", text: String(b.text ?? "") });
    else if (b.type === "image" || b.type === "document") {
      const url = dataUrl(b.source);
      if (url) out.push({ type: "image_url", image_url: { url } });
    }
  }
  return out;
}

/** The request in the OpenAI chat format Gemini understands. Thinking blocks and cache hints have no counterpart and are left out. */
export function toChat(params: Params): Record<string, unknown> {
  const messages: ChatMessage[] = [];
  const system = typeof params.system === "string" ? params.system : Array.isArray(params.system) ? textOf(params.system as unknown as Block[]) : "";
  if (system) messages.push({ role: "system", content: system });

  for (const m of params.messages) {
    if (typeof m.content === "string") {
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    const blocks = m.content as unknown as Block[];
    if (m.role === "assistant") {
      const calls = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          id: String(b.id),
          type: "function",
          function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) },
          ...(b[GEMINI_EXTRA] ? { extra_content: b[GEMINI_MODEL] && b[GEMINI_MODEL] !== params.model ? NEUTRAL_SIGNATURE : b[GEMINI_EXTRA] } : {}),
        }));
      const text = textOf(blocks);
      if (text || calls.length) messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // Tool results answer the calls right away; files they carry follow as a user message.
    const attached: unknown[] = [];
    for (const r of blocks.filter((b) => b.type === "tool_result")) {
      let text: string;
      if (typeof r.content === "string") text = r.content;
      else {
        const inner = (r.content ?? []) as Block[];
        text = textOf(inner);
        const files = parts(inner.filter((b) => b.type !== "text"));
        if (files.length) {
          attached.push(...files);
          text ||= "The file follows in the next message.";
        }
      }
      messages.push({ role: "tool", tool_call_id: String(r.tool_use_id), content: r.is_error ? `Error: ${text}` : text });
    }
    const rest = [...attached, ...parts(blocks.filter((b) => b.type !== "tool_result"))];
    if (rest.length) messages.push({ role: "user", content: rest });
  }

  const config = params.output_config as { effort?: string; format?: { type?: string; schema?: unknown } } | undefined;
  const effort = config?.effort === "max" || config?.effort === "xhigh" ? "high" : config?.effort;
  const tools = ((params.tools ?? []) as unknown as { name: string; description?: string; input_schema?: unknown }[]).filter((t) => t.input_schema);
  return {
    model: params.model,
    messages,
    max_tokens: params.max_tokens,
    ...(effort === "low" || effort === "medium" || effort === "high" ? { reasoning_effort: effort } : {}),
    ...(tools.length ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema } })) } : {}),
    ...(config?.format?.type === "json_schema" ? { response_format: { type: "json_schema", json_schema: { name: "result", schema: config.format.schema } } } : {}),
  };
}

type ChatResponse = {
  id?: string;
  model?: string;
  choices?: {
    finish_reason?: string;
    message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string }; extra_content?: unknown }[] };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** Gemini's answer in the shape the callers read. */
export function fromChat(body: unknown, model: string): Message {
  const b = (body ?? {}) as ChatResponse;
  const choice = b.choices?.[0];
  const content: Block[] = [];
  if (choice?.message?.content) content.push({ type: "text", text: choice.message.content, citations: null });
  (choice?.message?.tool_calls ?? []).forEach((call, i) => {
    let input: unknown = {};
    try {
      input = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      input = {};
    }
    content.push({
      type: "tool_use",
      id: call.id || `call_${i}_${Date.now()}`,
      name: call.function?.name ?? "",
      input,
      ...(call.extra_content ? { [GEMINI_EXTRA]: call.extra_content, [GEMINI_MODEL]: model } : {}),
    });
  });
  const reason = choice?.finish_reason;
  const stop_reason = content.some((c) => c.type === "tool_use") ? "tool_use" : reason === "length" ? "max_tokens" : reason === "content_filter" ? "refusal" : "end_turn";
  return {
    id: b.id ?? "gemini",
    type: "message",
    role: "assistant",
    model: b.model ?? model,
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: b.usage?.prompt_tokens ?? 0, output_tokens: b.usage?.completion_tokens ?? 0 },
  } as unknown as Message;
}

/** The chosen model first, then the fallbacks, each once. */
export async function geminiCreate(params: Params, fetcher: typeof fetch = fetch, pauseMs = 1000): Promise<Message> {
  const models = [...new Set([params.model, ...geminiFallbackModels()])];
  let failure: unknown = null;
  for (const [i, model] of models.entries()) {
    if (i > 0) {
      console.warn(`gemini: ${models[i - 1]} unavailable (${failure instanceof Anthropic.APIError ? (failure.status ?? "no answer") : "error"}), trying ${model}`);
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
    try {
      return await geminiOnce({ ...params, model }, fetcher, i < models.length - 1 ? ATTEMPT_MS : TIMEOUT_MS);
    } catch (e) {
      failure = e;
      const next = e instanceof Anthropic.APIConnectionError || (e instanceof Anthropic.APIError && e.status !== undefined && NEXT_MODEL.has(e.status));
      if (!next) throw e;
    }
  }
  throw failure;
}

async function geminiOnce(params: Params, fetcher: typeof fetch, timeoutMs: number): Promise<Message> {
  let res: Response;
  try {
    res = await fetcher(GEMINI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${assistantKey() ?? ""}` },
      body: JSON.stringify(toChat(params)),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Anthropic.APIConnectionError({ message: "AI service not reachable", cause: e instanceof Error ? e : undefined });
  }
  const raw = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  if (!res.ok) {
    // Gemini sometimes wraps the error in a list, and answers a wrong key with 400.
    const error = (Array.isArray(body) ? body[0] : body) as { error?: { message?: string } } | null;
    const message = error?.error?.message ?? raw.slice(0, 300);
    const status = res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(raw) ? 401 : res.status;
    throw Anthropic.APIError.generate(status, error ?? undefined, message, res.headers);
  }
  return fromChat(body, params.model);
}
