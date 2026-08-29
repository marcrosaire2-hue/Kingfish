import { describe, expect, it } from "vitest";
import { scanStockUnit } from "@/lib/stock-unit-repo";
import type { StockUnit } from "@/lib/stock-unit-types";

function unit(partial: Partial<StockUnit> & Pick<StockUnit, "qrId">): StockUnit {
  return {
    id: "1",
    productId: "poulet",
    productName: "Poulet",
    batchId: "b1",
    date: "2026-08-29",
    site: "zogbo",
    status: "prepare",
    movementId: null,
    preparedAt: "2026-08-29T10:00:00.000Z",
    sentAt: null,
    soldAt: null,
    lostAt: null,
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:00.000Z",
    ...partial,
  };
}

describe("scanStockUnit vente", () => {
  it("allows sell at zogbo for prepare unit", () => {
    const result = scanStockUnit(unit({ qrId: "KF-1" }), {
      date: "2026-08-29",
      site: "zogbo",
      workflow: "vente",
    });
    expect(result.allowedActions).toContain("sell");
  });

  it("refuses sell at zogbo when unit is at gbegamey", () => {
    const result = scanStockUnit(
      unit({ qrId: "KF-2", site: "gbegamey", status: "envoye" }),
      { date: "2026-08-29", site: "zogbo", workflow: "vente" },
    );
    expect(result.allowedActions).not.toContain("sell");
    expect(result.message).toMatch(/Gbégamey/i);
  });

  it("allows sell at gbegamey for envoye unit", () => {
    const result = scanStockUnit(
      unit({ qrId: "KF-3", site: "gbegamey", status: "envoye" }),
      { date: "2026-08-29", site: "gbegamey", workflow: "vente" },
    );
    expect(result.allowedActions).toContain("sell");
  });

  it("refuses already sold unit", () => {
    const result = scanStockUnit(
      unit({ qrId: "KF-4", status: "vendu", soldAt: "2026-08-29T12:00:00.000Z" }),
      { date: "2026-08-29", site: "zogbo", workflow: "vente" },
    );
    expect(result.allowedActions).toEqual([]);
    expect(result.message).toMatch(/déjà été vendu/i);
  });
});
