import { describe, expect, it } from "vitest";
import {
  formatTimeFr,
  isBackdatedRecord,
  isoDateInTimeZone,
} from "@/lib/datetime-fr";

describe("datetime-fr", () => {
  it("détecte une saisie tardive (jour comptable avant jour calendaire)", () => {
    expect(
      isBackdatedRecord("2026-08-27", "2026-08-28T14:50:19.735Z"),
    ).toBe(true);
    expect(
      isBackdatedRecord("2026-08-28", "2026-08-28T10:00:00.000Z"),
    ).toBe(false);
  });

  it("formate l'heure au fuseau Porto-Novo", () => {
    const day = isoDateInTimeZone("2026-08-28T14:50:19.735Z");
    expect(day).toBe("2026-08-28");
    expect(formatTimeFr("2026-08-28T14:50:19.735Z")).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});
