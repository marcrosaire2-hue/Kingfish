import { describe, expect, it } from "vitest";
import {
  effectiveShift,
  isShift,
  SHIFT_LABELS,
  SHIFTS,
} from "@/lib/auth-types";

describe("équipes de service", () => {
  it("propose exactement jour, nuit et hors équipe", () => {
    expect(SHIFTS).toEqual(["jour", "nuit", "aucune"]);
    for (const eq of SHIFTS) {
      expect(SHIFT_LABELS[eq]).toBeTruthy();
    }
  });

  it("reconnaît les équipes valides", () => {
    expect(isShift("jour")).toBe(true);
    expect(isShift("nuit")).toBe(true);
    expect(isShift("matin")).toBe(false);
    expect(isShift(undefined)).toBe(false);
  });

  it("rattache à « hors équipe » ce qui n'en porte aucune", () => {
    // Comptes et ventes antérieurs aux équipes : ils ne doivent pas être
    // attribués arbitrairement au jour ou à la nuit.
    expect(effectiveShift(undefined)).toBe("aucune");
    expect(effectiveShift(null)).toBe("aucune");
  });

  it("conserve une équipe déjà valide", () => {
    expect(effectiveShift("nuit")).toBe("nuit");
    expect(effectiveShift("jour")).toBe("jour");
  });
});
