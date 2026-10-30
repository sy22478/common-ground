import { MODELS, PRICES, TOKEN_FACTORY_BASE, type ModelKey } from "./config";
import type { SpendGuard } from "./spend";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  model: ModelKey;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  thinking: boolean;
  maxTokens: number;
  temperature?: number;
  json?: boolean;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
}

export interface ChatResult {
  model: ModelKey;
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
  usage: Usage;
  costUsd: number;
  ms: number;
}

export interface LLM {
  chat(request: ChatRequest): Promise<ChatResult>;
}

export class LLMError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export function costOf(model: ModelKey, usage: Pick<Usage, "prompt_tokens" | "completion_tokens">): number {
  const price = PRICES[model];
  return (usage.prompt_tokens * price.input + usage.completion_tokens * price.output) / 1e6;
}

// Worst case before the call: input estimated at 3 characters a token (generous), output at the full budget.
export function estimateCost(request: ChatRequest): number {
  const chars = JSON.stringify(request.messages).length + JSON.stringify(request.tools ?? []).length;
  return costOf(request.model, { prompt_tokens: Math.ceil(chars / 3), completion_tokens: request.maxTokens });
}

// Some Nemotron models write their thinking into the answer when thinking is on; keep only the answer.
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export class TokenFactoryLLM implements LLM {
  constructor(
    private apiKey: string,
    private guard: SpendGuard,
    private fetchImpl: typeof fetch = fetch,
    private timeoutMs = 120_000,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResult> {
    const reservation = await this.guard.reserve(estimateCost(request));
    let actual = 0;
    const started = Date.now();
    try {
      const body: Record<string, unknown> = {
        model: MODELS[request.model],
        messages: request.messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0.3,
        chat_template_kwargs: { enable_thinking: request.thinking },
      };
      if (request.tools?.length) {
        body.tools = request.tools;
        body.tool_choice = "auto";
        body.parallel_tool_calls = true; // several calls in one reply: the gathering stage depends on it
      }
      if (request.json) body.response_format = { type: "json_object" };
      const response = await this.fetchImpl(`${TOKEN_FACTORY_BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        const text = (await response.text()).replaceAll(this.apiKey, "[redacted]").slice(0, 300);
        throw new LLMError(response.status, `Token Factory ${response.status}: ${text}`);
      }
      const data = (await response.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] | null }; finish_reason?: string }[];
        usage?: Usage;
      };
      const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: request.maxTokens };
      actual = costOf(request.model, usage);
      const choice = data.choices?.[0];
      return {
        model: request.model,
        content: stripThinking(choice?.message?.content ?? ""),
        toolCalls: choice?.message?.tool_calls ?? [],
        finishReason: choice?.finish_reason ?? "unknown",
        usage,
        costUsd: actual,
        ms: Date.now() - started,
      };
    } catch (error) {
      // A timed-out call may still have been billed: keep the worst-case reservation rather than refund it.
      if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
        actual = reservation.usd;
      }
      throw error;
    } finally {
      await this.guard.settle(reservation, actual);
    }
  }
}
