import { describe, expect, it } from "vitest";
import { evaluateRateLimit } from "@/lib/security-rate-limit";

describe("plafonnement des endpoints sensibles", () => {
  it("laisse passer sous le plafond", () => {
    const r = evaluateRateLimit({
      count: 2,
      windowStart: 1_000,
      now: 1_100,
      limit: 5,
      windowMs: 60_000,
    });
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(3);
  });

  it("renvoie 429 logique au-delà du plafond", () => {
    const r = evaluateRateLimit({
      count: 5,
      windowStart: 1_000,
      now: 2_000,
      limit: 5,
      windowMs: 60_000,
    });
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it("repart de zéro après la fenêtre", () => {
    const r = evaluateRateLimit({
      count: 99,
      windowStart: 1_000,
      now: 70_000,
      limit: 5,
      windowMs: 60_000,
    });
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
  });
});
