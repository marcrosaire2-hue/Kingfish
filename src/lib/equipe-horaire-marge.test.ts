import { describe, expect, it } from "vitest";
import {
  EQUIPE_GRACE_MINUTES,
  isSoirGraceAfterMidnight,
  isWithinEquipePeriodeStrict,
  isWithinEquipePeriodeWithGrace,
} from "@/lib/equipe-horaire-marge";

describe("marge 15 min fin de créneau", () => {
  it("fixe la marge à 15 minutes", () => {
    expect(EQUIPE_GRACE_MINUTES).toBe(15);
  });

  it("matin : OK jusqu’à 16h15, bloqué après", () => {
    expect(
      isWithinEquipePeriodeWithGrace(
        "matin",
        new Date("2026-09-01T16:10:00+01:00"),
      ),
    ).toBe(true);
    expect(
      isWithinEquipePeriodeWithGrace(
        "matin",
        new Date("2026-09-01T16:15:00+01:00"),
      ),
    ).toBe(false);
    expect(
      isWithinEquipePeriodeStrict("matin", new Date("2026-09-01T16:10:00+01:00")),
    ).toBe(false);
  });

  it("nuit : OK jusqu’à 08h15", () => {
    expect(
      isWithinEquipePeriodeWithGrace(
        "nuit",
        new Date("2026-09-02T08:10:00+01:00"),
      ),
    ).toBe(true);
    expect(
      isWithinEquipePeriodeWithGrace(
        "nuit",
        new Date("2026-09-02T08:15:00+01:00"),
      ),
    ).toBe(false);
  });

  it("soir : OK jusqu’à 00h15 (marge après minuit)", () => {
    expect(
      isWithinEquipePeriodeWithGrace(
        "soir",
        new Date("2026-09-02T00:10:00+01:00"),
      ),
    ).toBe(true);
    expect(isSoirGraceAfterMidnight(new Date("2026-09-02T00:10:00+01:00"))).toBe(
      true,
    );
    expect(
      isWithinEquipePeriodeWithGrace(
        "soir",
        new Date("2026-09-02T00:15:00+01:00"),
      ),
    ).toBe(false);
  });
});
