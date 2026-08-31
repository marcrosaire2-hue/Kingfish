import { describe, expect, it } from "vitest";
import {
  assertGbegameyPlanningSale,
  GBEGAMEY_PLANNING_COMPTES,
  GBEGAMEY_PLANNING_START_ISO,
  isGbegameyPlanningActive,
  isWithinGbegameyPeriode,
  jourSlugFromIsoDate,
} from "@/lib/gbegamey-planning-comptes";

describe("planning 20 comptes Gbégamey", () => {
  it("expose exactement 20 comptes (6 nuit + 7 matin + 7 soir)", () => {
    expect(GBEGAMEY_PLANNING_COMPTES).toHaveLength(20);
    expect(GBEGAMEY_PLANNING_COMPTES.filter((c) => c.periode === "nuit")).toHaveLength(6);
    expect(GBEGAMEY_PLANNING_COMPTES.filter((c) => c.periode === "matin")).toHaveLength(7);
    expect(GBEGAMEY_PLANNING_COMPTES.filter((c) => c.periode === "soir")).toHaveLength(7);
    expect(GBEGAMEY_PLANNING_COMPTES.some((c) => c.periode === "nuit" && c.jourSlug === "mardi")).toBe(
      false,
    );
    expect(GBEGAMEY_PLANNING_COMPTES[0]?.username).toBe("equipe13");
    expect(GBEGAMEY_PLANNING_COMPTES.at(-1)?.username).toBe("equipe32");
  });

  it("s’active à partir du 2026-09-01", () => {
    expect(GBEGAMEY_PLANNING_START_ISO).toBe("2026-09-01");
    expect(isGbegameyPlanningActive("2026-08-31")).toBe(false);
    expect(isGbegameyPlanningActive("2026-09-01")).toBe(true);
  });

  it("applique les 3 créneaux", () => {
    expect(isWithinGbegameyPeriode("nuit", new Date("2026-09-02T03:00:00+01:00"))).toBe(true);
    expect(isWithinGbegameyPeriode("matin", new Date("2026-09-02T10:00:00+01:00"))).toBe(true);
    expect(isWithinGbegameyPeriode("soir", new Date("2026-09-02T18:00:00+01:00"))).toBe(true);
    expect(isWithinGbegameyPeriode("nuit", new Date("2026-09-02T10:00:00+01:00"))).toBe(false);
  });

  it("reconnaît le mardi", () => {
    expect(jourSlugFromIsoDate("2026-09-01")).toBe("mardi");
  });

  it("autorise un compte nuit hors mardi", () => {
    const nuitLundi = GBEGAMEY_PLANNING_COMPTES.find(
      (c) => c.periode === "nuit" && c.jourSlug === "lundi",
    )!;
    expect(() =>
      assertGbegameyPlanningSale({
        username: nuitLundi.username,
        serviceDate: "2026-09-07",
        now: new Date("2026-09-07T03:00:00+01:00"),
      }),
    ).not.toThrow();
  });

  it("autorise matin/soir le mardi", () => {
    const matinMardi = GBEGAMEY_PLANNING_COMPTES.find(
      (c) => c.periode === "matin" && c.jourSlug === "mardi",
    )!;
    expect(() =>
      assertGbegameyPlanningSale({
        username: matinMardi.username,
        serviceDate: "2026-09-01",
        now: new Date("2026-09-01T10:00:00+01:00"),
      }),
    ).not.toThrow();
  });

  it("ignore les comptes hors planning", () => {
    expect(() =>
      assertGbegameyPlanningSale({
        username: "equipe1",
        serviceDate: "2026-09-01",
        now: new Date("2026-09-01T10:00:00+01:00"),
      }),
    ).not.toThrow();
  });
});
