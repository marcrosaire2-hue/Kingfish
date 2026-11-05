import { describe, expect, it } from "vitest";
import { stockInitialDepuisComptages } from "@/lib/stock-si-repo";

describe("Stock initial : du début, puis du dernier comptage", () => {
  it("sans comptage : SI du début, ventes cumulées depuis le début", () => {
    const c = stockInitialDepuisComptages({
      si: 7,
      siDate: "2026-11-02",
      date: "2026-11-05",
      jours: [
        { date: "2026-11-02", vendus: 0, pertes: 0, compte: null },
        { date: "2026-11-03", vendus: 2, pertes: 0, compte: null },
        { date: "2026-11-05", vendus: 1, pertes: 0, compte: null },
      ],
    });
    expect(c.stockInitial).toBe(7);
    expect(c.vendus).toBe(3);
  });

  it("un comptage d'un jour passé devient le nouveau stock initial", () => {
    const c = stockInitialDepuisComptages({
      si: 20,
      siDate: "2026-11-02",
      date: "2026-11-05",
      jours: [
        { date: "2026-11-02", vendus: 5, pertes: 0, compte: null },
        { date: "2026-11-03", vendus: 3, pertes: 1, compte: 10 },
        { date: "2026-11-04", vendus: 2, pertes: 0, compte: null },
        { date: "2026-11-05", vendus: 1, pertes: 0, compte: null },
      ],
    });
    // Stock réel compté le 03/11 = 10 ; ventes cumulées depuis le 04/11.
    expect(c.stockInitial).toBe(10);
    expect(c.depuis).toBe("2026-11-03");
    expect(c.vendus).toBe(3);
    expect(c.pertes).toBe(0);
  });

  it("le comptage du jour consulté reste le stock physique (pas encore le SI)", () => {
    const c = stockInitialDepuisComptages({
      si: 20,
      siDate: "2026-11-02",
      date: "2026-11-05",
      jours: [
        { date: "2026-11-02", vendus: 5, pertes: 0, compte: null },
        { date: "2026-11-05", vendus: 2, pertes: 0, compte: 12 },
      ],
    });
    expect(c.stockInitial).toBe(20);
    expect(c.vendus).toBe(7);
  });
});
