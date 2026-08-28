import { describe, expect, it } from "vitest";
import { compareVenteChronology } from "@/lib/page-exports";

describe("compareVenteChronology", () => {
  it("classe par jour comptable puis par horodatage croissant", () => {
    const items = [
      { date: "2026-08-28", at: "2026-08-28T18:00:00.000Z" },
      { date: "2026-08-27", at: "2026-08-27T20:00:00.000Z" },
      { date: "2026-08-27", at: "2026-08-27T12:00:00.000Z" },
      { date: "2026-08-28", at: "2026-08-28T09:00:00.000Z" },
    ];

    const sorted = [...items].sort(compareVenteChronology);

    expect(sorted.map((i) => `${i.date}@${i.at.slice(11, 16)}`)).toEqual([
      "2026-08-27@12:00",
      "2026-08-27@20:00",
      "2026-08-28@09:00",
      "2026-08-28@18:00",
    ]);
  });
});
