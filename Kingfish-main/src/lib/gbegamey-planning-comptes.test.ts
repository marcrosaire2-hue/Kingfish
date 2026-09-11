import { describe, expect, it } from "vitest";
import {
  assertGbegameyPlanningSale,
  GBEGAMEY_PLANNING_COMPTES,
  GBEGAMEY_PLANNING_START_ISO,
  findGbegameyPlanningCompte,
  isGbegameyPlanningActive,
  isWithinGbegameyPeriode,
  jourSlugFromIsoDate,
} from "@/lib/gbegamey-planning-comptes";

describe("planning Gbégamey définitif", () => {
  it("conserve 13 comptes : 1 nuit + 7 matin + 5 soir", () => {
    expect(GBEGAMEY_PLANNING_COMPTES).toHaveLength(13);
    expect(GBEGAMEY_PLANNING_COMPTES.filter((c) => c.periode === "nuit")).toHaveLength(1);
    expect(GBEGAMEY_PLANNING_COMPTES.filter((c) => c.periode === "matin")).toHaveLength(7);
    expect(GBEGAMEY_PLANNING_COMPTES.filter((c) => c.periode === "soir")).toHaveLength(5);
    expect(GBEGAMEY_PLANNING_COMPTES[0]?.username).toBe("equipe13");
    expect(GBEGAMEY_PLANNING_COMPTES.at(-1)?.username).toBe("equipe25");
  });

  it("s’active à partir du 2026-09-01", () => {
    expect(GBEGAMEY_PLANNING_START_ISO).toBe("2026-09-01");
    expect(isGbegameyPlanningActive("2026-08-31")).toBe(false);
    expect(isGbegameyPlanningActive("2026-09-01")).toBe(true);
  });

  it("applique la rotation matin (lundi → équipe vendredi)", () => {
    const vendredi = GBEGAMEY_PLANNING_COMPTES.find(
      (c) => c.periode === "matin" && c.equipeJour === "vendredi",
    )!;
    expect(vendredi.joursAutorises).toEqual(["lundi"]);
    expect(() =>
      assertGbegameyPlanningSale({
        username: vendredi.username,
        serviceDate: "2026-09-07", // lundi
        now: new Date("2026-09-07T10:00:00+01:00"),
      }),
    ).not.toThrow();
  });

  it("applique le soir multi-jours (équipe lundi → lun + mer)", () => {
    const soirLundi = GBEGAMEY_PLANNING_COMPTES.find(
      (c) => c.periode === "soir" && c.equipeJour === "lundi",
    )!;
    expect([...soirLundi.joursAutorises]).toEqual(["lundi", "mercredi"]);
  });

  it("n’a qu’une équipe nuit, fermée le mardi 00h–08h", () => {
    const nuit = findGbegameyPlanningCompte("equipe13")!;
    expect(nuit.periode).toBe("nuit");
    expect(nuit.joursAutorises).not.toContain("mardi");
    expect(() =>
      assertGbegameyPlanningSale({
        username: "equipe13",
        serviceDate: "2026-09-01",
        now: new Date("2026-09-01T03:00:00+01:00"),
      }),
    ).toThrow(/fermé le mardi/);
  });

  it("refuse un compte matin pendant la nuit", () => {
    const matin = GBEGAMEY_PLANNING_COMPTES.find((c) => c.periode === "matin")!;
    expect(() =>
      assertGbegameyPlanningSale({
        username: matin.username,
        serviceDate: "2026-09-07",
        now: new Date("2026-09-07T03:00:00+01:00"),
      }),
    ).toThrow(/Équipe Nuit/);
  });

  it("applique les 3 créneaux horaires", () => {
    expect(isWithinGbegameyPeriode("nuit", new Date("2026-09-02T03:00:00+01:00"))).toBe(true);
    expect(isWithinGbegameyPeriode("matin", new Date("2026-09-02T10:00:00+01:00"))).toBe(true);
    expect(isWithinGbegameyPeriode("soir", new Date("2026-09-02T18:00:00+01:00"))).toBe(true);
  });

  it("reconnaît le mardi", () => {
    expect(jourSlugFromIsoDate("2026-09-01")).toBe("mardi");
  });
});
