import { Redis } from "@upstash/redis";

// Shared state for counters and caches. Serverless instances share it through Redis; tests use memory.
export interface Store {
  readonly kind: "memory" | "redis";
  incrByFloat(key: string, by: number, ttlSeconds?: number): Promise<number>;
  getNumber(key: string): Promise<number>;
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(keys: string[]): Promise<void>;
}

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private data = new Map<string, { value: unknown; expires: number | null }>();

  constructor(private now: () => number = () => Date.now()) {}

  private live(key: string) {
    const entry = this.data.get(key);
    if (entry && entry.expires !== null && entry.expires <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  async incrByFloat(key: string, by: number, ttlSeconds?: number): Promise<number> {
    const entry = this.live(key);
    const next = (typeof entry?.value === "number" ? entry.value : 0) + by;
    const expires = entry ? entry.expires : ttlSeconds ? this.now() + ttlSeconds * 1000 : null;
    this.data.set(key, { value: next, expires });
    return next;
  }

  async getNumber(key: string): Promise<number> {
    const value = this.live(key)?.value;
    return typeof value === "number" ? value : 0;
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const value = this.live(key)?.value;
    return value === undefined ? null : (value as T);
  }

  async setJSON(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.data.set(key, { value, expires: this.now() + ttlSeconds * 1000 });
  }

  async del(keys: string[]): Promise<void> {
    for (const key of keys) this.data.delete(key);
  }

  // For tests: everything currently stored.
  entries(): [string, unknown][] {
    return [...this.data.keys()].filter((k) => this.live(k)).map((k) => [k, this.data.get(k)!.value]);
  }
}

export class UpstashStore implements Store {
  readonly kind = "redis" as const;
  constructor(private redis: Redis) {}

  async incrByFloat(key: string, by: number, ttlSeconds?: number): Promise<number> {
    const value = Number(await this.redis.incrbyfloat(key, by));
    // A fresh key equals the increment: give it its expiry once.
    if (ttlSeconds && Math.abs(value - by) < 1e-12) await this.redis.expire(key, ttlSeconds);
    return value;
  }

  async getNumber(key: string): Promise<number> {
    const value = await this.redis.get<number | string>(key);
    return value === null ? 0 : Number(value);
  }

  async getJSON<T>(key: string): Promise<T | null> {
    return (await this.redis.get<T>(key)) ?? null;
  }

  async setJSON(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, { ex: ttlSeconds });
  }

  async del(keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys);
  }
}

let devStore: MemoryStore | undefined;

// Production must have Redis: per-instance memory would let each instance spend up to the cap on its own.
export function storeFromEnv(env: Record<string, string | undefined> = process.env): Store | null {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (url && token) return new UpstashStore(new Redis({ url, token }));
  if (env.NODE_ENV === "production") return null;
  devStore ??= new MemoryStore();
  return devStore;
}
