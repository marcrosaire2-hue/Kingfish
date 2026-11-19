import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlanningAccountBlockReason } from "@/lib/equipe-planning-access";
import { assertGbegameyEmployeeVentePlanning } from "@/lib/gbegamey-employee-planning";
import { assertGbegameyPlanningSale } from "@/lib/gbegamey-planning-comptes";
import { planningRestrictionsActives } from "@/lib/planning-restrictions";
import { assertZogboPlanningSale } from "@/lib/zogbo-planning-comptes";

// Dimanche 2026-11-22, 03h00 à Porto-Novo : aucun créneau de jour n'est ouvert.
const NUIT = new Date("2026-11-22T02:00:00Z");

afterEach(() => vi.unstubAllEnvs());

describe("restrictions de planning désactivables", () => {
  it("ne s'appliquent que si PLANNING_RESTRICTIONS vaut on", () => {
    vi.stubEnv("PLANNING_RESTRICTIONS", "");
    expect(planningRestrictionsActives()).toBe(false);
    vi.stubEnv("PLANNING_RESTRICTIONS", "on");
    expect(planningRestrictionsActives()).toBe(true);
  });

  it("désactivées, aucun compte n'est bloqué hors créneau", () => {
    vi.stubEnv("PLANNING_RESTRICTIONS", "");
    for (const username of ["equipe1", "equipe13", "gloria", "inès"]) {
      expect(getPlanningAccountBlockReason(username, NUIT), username).toBeNull();
    }
    expect(() =>
      assertGbegameyEmployeeVentePlanning({ username: "gloria", now: NUIT }),
    ).not.toThrow();
    expect(() =>
      assertZogboPlanningSale({
        username: "equipe1",
        serviceDate: "2026-11-22",
        now: NUIT,
      }),
    ).not.toThrow();
    expect(() =>
      assertGbegameyPlanningSale({
        username: "equipe13",
        serviceDate: "2026-11-22",
        now: NUIT,
      }),
    ).not.toThrow();
  });

  it("activées, le planning nominatif refuse toujours hors créneau", () => {
    vi.stubEnv("PLANNING_RESTRICTIONS", "on");
    expect(() =>
      assertGbegameyEmployeeVentePlanning({ username: "gloria", now: NUIT }),
    ).toThrow(/hors créneau/);
  });
});
