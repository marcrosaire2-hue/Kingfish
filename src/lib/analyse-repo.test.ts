import { describe, expect, it } from "vitest";
import { parseAnalyseQuery, ventesActivesMatch } from "@/lib/analyse-repo";

describe("filtre CA actif de l’analyse", () => {
  it("exclut les combos, les lignes annulées et le CA exclu (G2 / G3)", () => {
    const match = ventesActivesMatch({ date: "2026-08-01" });
    expect(match.cancelledAt).toBeNull();
    expect(match.caExcluded).toEqual({ $ne: true });
    expect(match.kind).toEqual({ $ne: "combo" });
    expect(match.date).toBe("2026-08-01");
  });

  it("conserve un filtre de nature demandé sans réintroduire les combos", () => {
    const match = ventesActivesMatch({ kind: "plat" });
    expect(match.kind).toBe("plat");
  });
});

describe("validation des filtres", () => {
  it("refuse une date non calendaire", () => {
    expect(() =>
      parseAnalyseQuery(new URLSearchParams("date=2026-02-30"), "2026-08-01"),
    ).toThrow(/Date invalide/);
  });

  it("refuse une équipe inconnue", () => {
    expect(() =>
      parseAnalyseQuery(new URLSearchParams("shift=brunch"), "2026-08-01"),
    ).toThrow(/Équipe invalide/);
  });
});
