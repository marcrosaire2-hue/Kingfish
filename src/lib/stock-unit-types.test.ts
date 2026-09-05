import { describe, expect, it } from "vitest";
import { assertPlatStatsConsistent } from "@/lib/stock-unit-repo";
import {
  canTransitionUnitStatus,
} from "@/lib/stock-unit-types";
import type { PlatUnitStats } from "@/lib/stock-unit-types";

function stats(partial: Partial<PlatUnitStats> & Pick<PlatUnitStats, "productId" | "productName">): PlatUnitStats {
  return {
    prepared: 0,
    sentAggregate: 0,
    soldAggregate: 0,
    pertesAggregate: 0,
    stockAggregate: 0,
    qrGenerated: 0,
    qrSent: 0,
    qrRemainingZogbo: 0,
    qrVendu: 0,
    qrPerdu: 0,
    qrToGenerate: 0,
    stockRemaining: 0,
    ...partial,
  };
}

describe("stock unit transitions", () => {
  it("allows prepare → envoye", () => {
    expect(canTransitionUnitStatus("prepare", "envoye")).toBe(true);
  });

  it("forbids vendu → envoye", () => {
    expect(canTransitionUnitStatus("vendu", "envoye")).toBe(false);
  });

  it("case 1: 20 prepared, 20 QR", () => {
    const s = stats({
      productId: "p1",
      productName: "Poulet",
      prepared: 20,
      qrGenerated: 20,
      qrRemainingZogbo: 20,
      qrToGenerate: 0,
    });
    expect(assertPlatStatsConsistent(s)).toEqual([]);
  });

  it("case 2: 20 prepared, 12 sent, 8 at zogbo", () => {
    const s = stats({
      productId: "p1",
      productName: "Poulet",
      prepared: 20,
      sentAggregate: 12,
      qrGenerated: 20,
      qrSent: 12,
      qrRemainingZogbo: 8,
      qrToGenerate: 0,
    });
    expect(s.qrRemainingZogbo).toBe(8);
    expect(assertPlatStatsConsistent(s)).toEqual([]);
  });

  it("case 3: 20 prepared, 0 sent", () => {
    const s = stats({
      productId: "p1",
      productName: "Poulet",
      prepared: 20,
      qrGenerated: 20,
      qrRemainingZogbo: 20,
      sentAggregate: 0,
      qrSent: 0,
    });
    expect(s.qrRemainingZogbo).toBe(20);
  });

  it("case 5: more QR than prepared is inconsistent", () => {
    const s = stats({
      productId: "p1",
      productName: "Poulet",
      prepared: 10,
      qrGenerated: 15,
    });
    expect(assertPlatStatsConsistent(s).length).toBeGreaterThan(0);
  });
});
