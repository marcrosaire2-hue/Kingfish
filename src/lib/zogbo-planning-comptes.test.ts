import { describe, expect, it } from "vitest";
import {
  assertZogboPlanningSale,
  isWithinZogboPeriode,
  isZogboPlanningActive,
  jourSlugFromIsoDate,
  ZOGBO_PLANNING_COMPTES,
  ZOGBO_PLANNING_START_ISO,
} from "@/lib/zogbo-planning-comptes";

describe("planning 12 comptes Zogbo", () => {
  it("expose exactement 12 comptes (6 matin + 6 soir)", () => {
    expect(ZOGBO_PLANNING_COMPTES).toHaveLength(12);
    expect(ZOGBO_PLANNING_COMPTES.filter((c) => c.periode === "matin")).toHaveLength(6);
    expect(ZOGBO_PLANNING_COMPTES.filter((c) => c.periode === "soir")).toHaveLength(6);
  });

  it("s’active à partir du 2026-09-01", () => {
    expect(ZOGBO_PLANNING_START_ISO).toBe("2026-09-01");
    expect(isZogboPlanningActive("2026-08-31")).toBe(false);
    expect(isZogboPlanningActive("2026-09-01")).toBe(true);
  });

  it("reconnaît les jours ISO", () => {
    expect(jourSlugFromIsoDate("2026-08-31")).toBe("lundi");
    expect(jourSlugFromIsoDate("2026-09-01")).toBe("mardi");
    expect(jourSlugFromIsoDate("2026-09-06")).toBe("dimanche");
  });

  it("applique les créneaux matin / soir", () => {
    expect(isWithinZogboPeriode("matin", new Date("2026-09-01T10:00:00+01:00"))).toBe(true);
    expect(isWithinZogboPeriode("matin", new Date("2026-09-01T17:00:00+01:00"))).toBe(false);
    expect(isWithinZogboPeriode("soir", new Date("2026-09-01T17:00:00+01:00"))).toBe(true);
    expect(isWithinZogboPeriode("soir", new Date("2026-09-01T10:00:00+01:00"))).toBe(false);
  });

  it("ne bloque pas avant la date d’activation", () => {
    expect(() =>
      assertZogboPlanningSale({
        username: "zogbo.matin.mardi",
        serviceDate: "2026-08-31",
        now: new Date("2026-08-31T10:00:00+01:00"),
      }),
    ).not.toThrow();
  });

  it("refuse le lundi une fois actif", () => {
    expect(() =>
      assertZogboPlanningSale({
        username: "zogbo.matin.mardi",
        serviceDate: "2026-09-07",
        now: new Date("2026-09-07T10:00:00+01:00"),
      }),
    ).toThrow(/fermé le lundi/);
  });

  it("refuse un compte hors jour", () => {
    expect(() =>
      assertZogboPlanningSale({
        username: "zogbo.matin.mardi",
        serviceDate: "2026-09-02",
        now: new Date("2026-09-02T10:00:00+01:00"),
      }),
    ).toThrow(/réservé au mardi/);
  });

  it("autorise le bon compte le bon jour dans le créneau", () => {
    expect(() =>
      assertZogboPlanningSale({
        username: "zogbo.matin.mardi",
        serviceDate: "2026-09-01",
        now: new Date("2026-09-01T10:00:00+01:00"),
      }),
    ).not.toThrow();
    expect(() =>
      assertZogboPlanningSale({
        username: "zogbo.soir.mardi",
        serviceDate: "2026-09-01",
        now: new Date("2026-09-01T18:00:00+01:00"),
      }),
    ).not.toThrow();
  });

  it("ignore les comptes hors planning", () => {
    expect(() =>
      assertZogboPlanningSale({
        username: "gestion2",
        serviceDate: "2026-09-07",
        now: new Date("2026-09-07T10:00:00+01:00"),
      }),
    ).not.toThrow();
  });
});
