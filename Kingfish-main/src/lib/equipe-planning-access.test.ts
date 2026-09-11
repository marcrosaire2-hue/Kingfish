import { describe, expect, it } from "vitest";
import { getPlanningAccountBlockReason } from "@/lib/equipe-planning-access";

describe("accès comptes planning hors créneau", () => {
  it("laisse passer les comptes hors planning", () => {
    expect(
      getPlanningAccountBlockReason(
        "admin",
        new Date("2026-09-01T03:00:00+01:00"),
      ),
    ).toBeNull();
  });

  it("bloque equipe1 hors créneau après activation", () => {
    const reason = getPlanningAccountBlockReason(
      "equipe1",
      new Date("2026-09-01T18:00:00+01:00"),
    );
    expect(reason).toMatch(/hors service|créneau/i);
  });

  it("autorise equipe1 le mardi matin dans le créneau", () => {
    expect(
      getPlanningAccountBlockReason(
        "equipe1",
        new Date("2026-09-01T10:00:00+01:00"),
      ),
    ).toBeNull();
  });

  it("ne bloque pas avant la date d’activation", () => {
    expect(
      getPlanningAccountBlockReason(
        "equipe1",
        new Date("2026-08-31T18:00:00+01:00"),
      ),
    ).toBeNull();
  });
});
