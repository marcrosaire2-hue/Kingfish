import { describe, expect, it } from "vitest";
import {
  assertGbegameyEmployeeVentePlanning,
  GBEGAMEY_EMPLOYEE_GRACE_MINUTES,
  isGbegameyPlanningEmployee,
} from "@/lib/gbegamey-employee-planning";

// 2026-09-07 = lundi … 2026-09-13 = dimanche.
describe("planning nominatif Gbégamey — ventes", () => {
  it("autorise Gloria sur son créneau matin du lundi", () => {
    expect(() =>
      assertGbegameyEmployeeVentePlanning({
        username: "gloria",
        now: new Date("2026-09-07T10:00:00+01:00"),
      }),
    ).not.toThrow();
  });

  it("refuse Gloria le lundi soir (équipe Inès + Précilia)", () => {
    expect(() =>
      assertGbegameyEmployeeVentePlanning({
        username: "gloria",
        now: new Date("2026-09-07T18:00:00+01:00"),
      }),
    ).toThrow(/hors créneau planifié/);
  });

  it(`tolère ${GBEGAMEY_EMPLOYEE_GRACE_MINUTES} min après la fin du service`, () => {
    expect(() =>
      assertGbegameyEmployeeVentePlanning({
        username: "gloria",
        now: new Date("2026-09-07T16:29:00+01:00"),
      }),
    ).not.toThrow();
  });

  it("refuse après la marge de 30 min", () => {
    expect(() =>
      assertGbegameyEmployeeVentePlanning({
        username: "gloria",
        now: new Date("2026-09-07T16:31:00+01:00"),
      }),
    ).toThrow(/hors créneau planifié/);
  });

  it("laisse passer un compte hors planning (admin, daf…)", () => {
    expect(() =>
      assertGbegameyEmployeeVentePlanning({
        username: "marc",
        now: new Date("2026-09-07T03:00:00+01:00"),
      }),
    ).not.toThrow();
  });

  it("respecte le jour de repos (Bijou = mardi)", () => {
    expect(() =>
      assertGbegameyEmployeeVentePlanning({
        username: "bijou",
        now: new Date("2026-09-08T10:00:00+01:00"),
      }),
    ).toThrow(/hors créneau planifié/);
    expect(() =>
      assertGbegameyEmployeeVentePlanning({
        username: "bijou",
        now: new Date("2026-09-08T20:00:00+01:00"),
      }),
    ).toThrow(/hors créneau planifié/);
  });

  it("prolonge le service du soir (vendredi) jusqu'à 00h30 le samedi", () => {
    expect(() =>
      assertGbegameyEmployeeVentePlanning({
        username: "rita",
        now: new Date("2026-09-12T00:15:00+01:00"), // samedi 00h15, fin du soir vendredi
      }),
    ).not.toThrow();
    expect(() =>
      assertGbegameyEmployeeVentePlanning({
        username: "rita",
        now: new Date("2026-09-12T00:35:00+01:00"),
      }),
    ).toThrow(/hors créneau planifié/);
  });

  it("reconnaît les comptes du planning (accents inclus)", () => {
    expect(isGbegameyPlanningEmployee("inès")).toBe(true);
    expect(isGbegameyPlanningEmployee("précilia")).toBe(true);
    expect(isGbegameyPlanningEmployee("INÈS")).toBe(true);
    expect(isGbegameyPlanningEmployee("marc")).toBe(false);
    expect(isGbegameyPlanningEmployee(null)).toBe(false);
  });
});
