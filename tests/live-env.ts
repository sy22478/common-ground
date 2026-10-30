import { existsSync, readFileSync } from "node:fs";
import type { ChatRequest, ChatResult, LLM } from "@/lib/llm";

// Live tests only: read a key from the environment or the ignored .env / .env.local files. Never print it.
export function liveKey(name: string): string {
  if (process.env[name]) return process.env[name]!;
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const [k, ...rest] = line.split("=");
      if (k?.trim() === name) {
        const v = rest.join("=").trim().replace(/^["']|["']$/g, "");
        if (v) return v;
      }
    }
  }
  throw new Error(`${name} is not set`);
}

export const has = (name: string) => {
  try {
    return Boolean(liveKey(name));
  } catch {
    return false;
  }
};

// Keeps what the planner was shown and what it answered, for a private trace in .qloo/: the only way to see why a
// plan was sent back or dropped.
export class RecordingLLM implements LLM {
  readonly calls: { model: string; thinking: boolean; messages: unknown; result: ChatResult }[] = [];
  constructor(private inner: LLM) {}
  async chat(request: ChatRequest): Promise<ChatResult> {
    const result = await this.inner.chat(request);
    this.calls.push({ model: request.model, thinking: request.thinking, messages: request.model === "super" ? request.messages.length : structuredClone(request.messages), result });
    return result;
  }
}
