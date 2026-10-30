import { healthReader } from "@/lib/health";
import { storeFromEnv } from "@/lib/store";

export const runtime = "nodejs";

// One reader for the life of this instance: it keeps the last reading of the counters for a minute (lib/health.ts).
const health = healthReader();

export async function GET(): Promise<Response> {
  const { body, cacheControl } = await health(storeFromEnv());
  return Response.json(body, { headers: { "Cache-Control": cacheControl } });
}
