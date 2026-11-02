import { describe, expect, it, vi } from "vitest";
import { cached, invalidateCache } from "@/lib/ttl-cache";

describe("ttl-cache", () => {
  it("partage une seule lecture entre appels simultanés puis la réutilise", async () => {
    const load = vi.fn(async () => ({ n: 1 }));
    const [a, b] = await Promise.all([
      cached("t1", 1000, load),
      cached("t1", 1000, load),
    ]);
    const c = await cached("t1", 1000, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect([a.n, b.n, c.n]).toEqual([1, 1, 1]);
  });

  it("rend des copies : modifier le résultat ne corrompt pas le cache", async () => {
    const first = await cached("t2", 1000, async () => ({ liste: [1, 2] }));
    first.liste.push(99);
    const second = await cached("t2", 1000, async () => ({ liste: [] }));
    expect(second.liste).toEqual([1, 2]);
  });

  it("relit après invalidation ou expiration, et ne garde pas une erreur", async () => {
    let n = 0;
    const load = async () => ++n;
    expect(await cached("t3", 1000, load)).toBe(1);
    invalidateCache("t3");
    expect(await cached("t3", 1000, load)).toBe(2);
    await new Promise((r) => setTimeout(r, 15));
    expect(await cached("t3", 5, load)).toBe(3);

    await expect(
      cached("t4", 1000, async () => {
        throw new Error("base indisponible");
      }),
    ).rejects.toThrow("base indisponible");
    expect(await cached("t4", 1000, async () => "ok")).toBe("ok");
  });
});
