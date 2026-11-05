import { describe, expect, it } from "vitest";
import {
  inferLegacyZogboStockInitials,
  resolveStocksInitiauxAsOf,
  ZOGBO_INITIAL_STOCK_START_DATE,
} from "@/lib/stock-si-repo";

describe("inferLegacyZogboStockInitials", () => {
  it("uses the first non-zero stock entry for each Zogbo product", () => {
    const inferred = inferLegacyZogboStockInitials(
      [
        {
          _id: "2026-11-02",
          lines: [{ productId: "plat-1", prepared: 4, stock: 14 }],
          accompanimentLines: [{ productId: "local-1", prepared: 3 }],
        },
        {
          _id: "2026-10-31",
          lines: [{ productId: "plat-1", prepared: 10, stock: 10 }],
          accompanimentLines: [
            { productId: "local-1", initialStock: 7, prepared: 0 },
          ],
        },
      ],
      [
        { kind: "plat", productId: "plat-1" },
        { kind: "local", productId: "local-1" },
        { kind: "plat", productId: "not-entered" },
        { kind: "boisson", productId: "drink-1", unitsPerCasier: 24 },
      ],
    );

    expect(inferred).toEqual([
      { kind: "plat", productId: "plat-1", si: 10, date: "2026-10-31" },
      { kind: "local", productId: "local-1", si: 7, date: "2026-10-31" },
    ]);
  });

  it("ignores zero quantities and products not requested for migration", () => {
    const inferred = inferLegacyZogboStockInitials(
      [
        {
          _id: "2026-10-31",
          lines: [
            { productId: "plat-1", prepared: 0, stock: 0 },
            { productId: "plat-2", prepared: 8, stock: 8 },
          ],
        },
      ],
      [{ kind: "plat", productId: "plat-1" }],
    );

    expect(inferred).toEqual([]);
  });

  it("uses the explicitly recorded initial stock before daily stock values", () => {
    const inferred = inferLegacyZogboStockInitials(
      [
        {
          _id: "2026-10-31",
          lines: [
            {
              productId: "plat-1",
              initialStock: 12,
              prepared: 0,
              stock: 0,
            },
          ],
        },
        {
          _id: "2026-11-01",
          lines: [{ productId: "plat-1", prepared: 5, stock: 5 }],
        },
      ],
      [{ kind: "plat", productId: "plat-1" }],
    );

    expect(inferred).toEqual([
      { kind: "plat", productId: "plat-1", si: 12, date: "2026-10-31" },
    ]);
  });

  it("converts legacy beverage opening stock from cases to bottles", () => {
    const inferred = inferLegacyZogboStockInitials(
      [
        {
          _id: "2026-11-01",
          beverageLines: [
            { productId: "drink-1", initialStockZogbo: 1.5 },
          ],
        },
      ],
      [
        {
          kind: "boisson",
          productId: "drink-1",
          unitsPerCasier: 24,
        },
      ],
    );

    expect(inferred).toEqual([
      {
        kind: "boisson",
        productId: "drink-1",
        si: 36,
        date: ZOGBO_INITIAL_STOCK_START_DATE,
      },
    ]);
  });

  it("hides opening stock before October 31 and shows it from that date", () => {
    const stocks = [
      {
        _id: "zogbo:boisson:drink-1",
        site: "zogbo" as const,
        kind: "boisson" as const,
        productId: "drink-1",
        si: 36,
        date: ZOGBO_INITIAL_STOCK_START_DATE,
        at: "2026-11-05T00:00:00.000Z",
      },
    ];

    expect(
      resolveStocksInitiauxAsOf(stocks, [], "2026-10-30").has(
        "boisson:drink-1",
      ),
    ).toBe(false);
    expect(
      resolveStocksInitiauxAsOf(stocks, [], ZOGBO_INITIAL_STOCK_START_DATE).get(
        "boisson:drink-1",
      ),
    ).toBe(36);
  });

  it("uses the latest count as the initial stock from the count date on", () => {
    const stocks = [
      {
        _id: "zogbo:boisson:drink-1",
        site: "zogbo" as const,
        kind: "boisson" as const,
        productId: "drink-1",
        si: 36,
        date: ZOGBO_INITIAL_STOCK_START_DATE,
        at: "2026-11-05T00:00:00.000Z",
      },
    ];
    const counts = [
      {
        kind: "boisson" as const,
        productId: "drink-1",
        qty: 18,
        date: "2026-11-03",
      },
      {
        kind: "boisson" as const,
        productId: "drink-1",
        qty: 12,
        date: "2026-11-05",
      },
    ];

    expect(
      resolveStocksInitiauxAsOf(stocks, counts, "2026-11-02").get(
        "boisson:drink-1",
      ),
    ).toBe(36);
    expect(
      resolveStocksInitiauxAsOf(stocks, counts, "2026-11-04").get(
        "boisson:drink-1",
      ),
    ).toBe(18);
    expect(
      resolveStocksInitiauxAsOf(stocks, counts, "2026-11-05").get(
        "boisson:drink-1",
      ),
    ).toBe(12);
  });

  it("treats a counted zero as the initial stock", () => {
    const result = resolveStocksInitiauxAsOf(
      [],
      [{ kind: "boisson", productId: "drink-1", qty: 0, date: "2026-11-03" }],
      "2026-11-03",
    );

    expect(result.get("boisson:drink-1")).toBe(0);
  });
});
