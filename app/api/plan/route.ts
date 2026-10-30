import { runPlan, type AgentEvent } from "@/lib/agent";
import { judgingOver, limits as readLimits, livePlanningOn } from "@/lib/config";
import { FamilySchema, refusalMessage } from "@/lib/family";
import { checkRate, hashIp } from "@/lib/ratelimit";
import { clientIp, hashSecret, makeDeps } from "@/lib/server";
import { JUDGING_OVER_MESSAGE, pausedMessage, spendStatus } from "@/lib/spend";
import { storeFromEnv } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_BODY = 8_000;

function reply(status: number, error: string, message: string, headers: Record<string, string> = {}) {
  return Response.json({ error, message }, { status, headers });
}

export async function POST(request: Request): Promise<Response> {
  // Off by default: no model call can be made from the web until LIVE_PLANNING=on is set deliberately.
  if (judgingOver()) return reply(503, "ended", JUDGING_OVER_MESSAGE);
  if (!livePlanningOn()) return reply(503, "paused", "Live planning is switched off right now.");

  const store = storeFromEnv();
  const secret = hashSecret();
  if (!store || !secret) return reply(503, "unavailable", "Planning is not configured on this server.");
  const limits = readLimits();

  const body = await request.text();
  if (body.length > MAX_BODY) return reply(413, "too_large", "That request is too large.");
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    // not JSON: refused below with the general line
  }
  const parsed = FamilySchema.safeParse(json);
  if (!parsed.success) return reply(400, "invalid", refusalMessage(parsed.error.issues));
  const family = parsed.data;

  const rate = await checkRate(store, hashIp(clientIp(request), secret), limits);
  if (!rate.ok) {
    const when = rate.window === "hour" ? "in an hour" : "tomorrow";
    return reply(429, "rate_limited", `You have planned a lot of visits. Please try again ${when}.`, { "Retry-After": String(rate.retryAfterSeconds) });
  }

  const status = await spendStatus(store, limits);
  if (status.pausedFor) return reply(503, "cap", pausedMessage(status.pausedFor));

  const deps = makeDeps(store, process.env, limits);
  if (!deps) return reply(503, "unavailable", "Planning is not configured on this server.");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // If the visitor closes the page, writes fail; the plan still ends within its cost cap.
      const write = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // stream already closed by the client
        }
      };
      const send = (event: AgentEvent) => write(`data: ${JSON.stringify(event)}\n\n`);
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), 10_000);
      try {
        await runPlan(family, deps, send);
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
