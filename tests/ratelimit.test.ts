import { describe, expect, it } from "vitest";
import { limits } from "@/lib/config";
import { checkRate, hashIp } from "@/lib/ratelimit";
import { MemoryStore } from "@/lib/store";

const lim = limits({});

describe("rate limits", () => {
  it("allows 6 plans an hour, then asks to wait until the next hour", async () => {
    const store = new MemoryStore();
    const at = new Date("2026-10-20T12:15:00Z");
    for (let i = 0; i < 6; i++) expect((await checkRate(store, "ip", lim, at)).ok).toBe(true);
    const refused = await checkRate(store, "ip", lim, at);
    expect(refused).toEqual({ ok: false, window: "hour", retryAfterSeconds: 45 * 60 });
    expect((await checkRate(store, "ip", lim, new Date("2026-10-20T13:00:01Z"))).ok).toBe(true);
  });

  it("allows 10 plans a day across hours", async () => {
    const store = new MemoryStore();
    let accepted = 0;
    for (let h = 0; h < 6; h++) {
      for (let i = 0; i < 6; i++) {
        const r = await checkRate(store, "ip", lim, new Date(Date.UTC(2026, 9, 20, h, 5)));
        if (r.ok) accepted++;
      }
    }
    expect(accepted).toBe(10);
  });

  it("keeps addresses apart and stores only a hash", () => {
    const a = hashIp("203.0.113.7", "salt");
    expect(a).not.toContain("203");
    expect(a).toBe(hashIp("203.0.113.7", "salt"));
    expect(a).not.toBe(hashIp("203.0.113.8", "salt"));
    expect(a).not.toBe(hashIp("203.0.113.7", "other"));
  });
});
