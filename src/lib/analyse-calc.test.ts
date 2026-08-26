import { describe, expect, it } from "vitest";
import {
  analyseWindow,
  applyReductionsToProducts,
  buildAnalyseReport,
  buildHealth,
  classifyProduct,
  costIsKnown,
  emptyTotals,
  pctChange,
  productMargin,
  rankProducts,
  resolveAnalyseSite,
  snapshotFromHouse,
  type ProductSnapshot,
  type TotalsSnapshot,
} from "@/lib/analyse-calc";

function product(
  over: Partial<ProductSnapshot> & Pick<ProductSnapshot, "productId" | "name" | "kind">,
): ProductSnapshot {
  const caBrut = over.caBrut ?? 0;
  const remises = over.remises ?? 0;
  const caNet = over.caNet ?? Math.max(0, caBrut - remises);
  const costAmount = over.costAmount ?? 0;
  const costKnown = over.costKnown ?? costIsKnown(over.kind, costAmount);
  const margin = productMargin(caNet, costAmount, costKnown);
  return {
    qty: 0,
    caBrut,
    remises,
    caNet,
    costAmount,
    costKnown,
    marginAmount: over.marginAmount ?? margin.amount,
    marginPct: over.marginPct ?? margin.pct,
    ...over,
  };
}

function totals(over: Partial<TotalsSnapshot> = {}): TotalsSnapshot {
  return { ...emptyTotals(), ...over };
}

describe("fenêtres de comparaison", () => {
  it("compare un jour à la veille, sans utiliser la date du jour système", () => {
    const w = analyseWindow("day", "2026-03-15");
    expect(w.from).toBe("2026-03-15");
    expect(w.to).toBe("2026-03-15");
    expect(w.previousFrom).toBe("2026-03-14");
    expect(w.previousTo).toBe("2026-03-14");
  });

  it("compare 7 jours glissants aux 7 jours précédents", () => {
    const w = analyseWindow("week", "2026-08-24");
    expect(w.from).toBe("2026-08-18");
    expect(w.to).toBe("2026-08-24");
    expect(w.previousFrom).toBe("2026-08-11");
    expect(w.previousTo).toBe("2026-08-17");
  });

  it("compare le mois à date au même nombre de jours du mois précédent (y compris février)", () => {
    const w = analyseWindow("month", "2026-03-31");
    expect(w.from).toBe("2026-03-01");
    expect(w.to).toBe("2026-03-31");
    expect(w.previousFrom).toBe("2026-02-01");
    expect(w.previousTo).toBe("2026-02-28");
  });
});

describe("G1 — CA net = brut − remises POS", () => {
  it("impute les remises au produit et refuse un CA net supérieur au brut", () => {
    const rows = applyReductionsToProducts(
      [
        {
          productId: "p1",
          name: "Thiof",
          kind: "plat",
          qty: 10,
          caBrut: 100_000,
          costAmount: 0,
        },
      ],
      new Map([["plat::p1", 8_000]]),
    );
    expect(rows[0]?.caNet).toBe(92_000);
    expect(rows[0]?.remises).toBe(8_000);
  });
});

describe("G6 / G7 — coût connu vs inconnu", () => {
  it("connaît le coût boisson même à 0 (prix d’achat figé)", () => {
    expect(costIsKnown("boisson", 0)).toBe(true);
    const m = productMargin(2000, 0, true);
    expect(m.amount).toBe(2000);
  });

  it("connaît le coût extra à 0 (fiche absente = CMV 0, G7)", () => {
    expect(costIsKnown("extra", 0)).toBe(true);
  });

  it("ne fabrique pas de marge plat si le coût historique est 0", () => {
    expect(costIsKnown("plat", 0)).toBe(false);
    expect(productMargin(50_000, 0, false)).toEqual({ amount: null, pct: null });
  });

  it("calcule une marge plat seulement si un costPrice figé positif existe", () => {
    expect(costIsKnown("plat", 12_000)).toBe(true);
    expect(productMargin(50_000, 12_000, true).amount).toBe(38_000);
  });
});

describe("classification produits", () => {
  it("ne classe pas « à revoir » après une seule période faible sans historique", () => {
    const current = product({
      productId: "x",
      name: "Nouveau",
      kind: "plat",
      qty: 2,
      caNet: 4000,
    });
    const { advice, confidence } = classifyProduct(current, undefined, 1, null);
    expect(advice).toBe("À maintenir");
    expect(confidence).toBe("faible");
  });

  it("surveille une baisse de volumes avec historique suffisant", () => {
    const current = product({
      productId: "t",
      name: "Thiof",
      kind: "plat",
      qty: 5,
      caNet: 25_000,
    });
    const previous = product({
      productId: "t",
      name: "Thiof",
      kind: "plat",
      qty: 40,
      caNet: 200_000,
    });
    expect(classifyProduct(current, previous, 5, null).advice).toBe(
      "À surveiller",
    );
  });

  it("développe un produit en hausse avec historique", () => {
    const current = product({
      productId: "b",
      name: "Bissap",
      kind: "boisson",
      qty: 40,
      caNet: 80_000,
      costAmount: 20_000,
    });
    const previous = product({
      productId: "b",
      name: "Bissap",
      kind: "boisson",
      qty: 20,
      caNet: 40_000,
      costAmount: 10_000,
    });
    expect(classifyProduct(current, previous, 10, 50).advice).toBe(
      "À développer",
    );
  });

  it("optimise un best-seller à marge connue faible", () => {
    const current = product({
      productId: "s",
      name: "Soda",
      kind: "boisson",
      qty: 100,
      caNet: 200_000,
      costAmount: 170_000,
    });
    expect(classifyProduct(current, current, 25, 40).advice).toBe("À optimiser");
  });

  it("classe « à revoir » seulement sur deux périodes déjà faibles", () => {
    const low = product({
      productId: "z",
      name: "Rare",
      kind: "local",
      qty: 1,
      caNet: 1500,
    });
    const prev = product({
      productId: "z",
      name: "Rare",
      kind: "local",
      qty: 2,
      caNet: 3000,
    });
    expect(classifyProduct(low, prev, 0.4, null).advice).toBe("À revoir");
  });
});

describe("G8 / G9 — hors résultat", () => {
  it("n’intègre pas les achats stock ni les acquisitions d’immos dans les charges d’exploitation", () => {
    const snap = snapshotFromHouse({
      caBrut: 1_000_000,
      remises: 20_000,
      caNet: 980_000,
      cmv: 300_000,
      chargesExploitation: 400_000,
      resultat: 580_000,
      pertes: 5_000,
      achatsStock: 200_000,
      amortissements: 8_000,
      acquisitionsImmobilisations: 1_500_000,
      caisseDepenses: 50_000,
      caisseRecettes: 10_000,
      epuises: 0,
    });
    expect(snap.chargesExploitation).toBe(400_000);
    expect(snap.achatsStock).toBe(200_000);
    expect(snap.acquisitionsImmobilisations).toBe(1_500_000);
    expect(snap.resultat).toBe(580_000);
    expect(snap.margeBrute).toBe(680_000);
  });
});

describe("variations relatives", () => {
  it("ne fabrique pas de pourcentage si la base est nulle (pas d’alerte « grand chiffre »)", () => {
    expect(pctChange(500_000, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(80, 100)).toBe(-20);
  });
});

describe("isolation des sites", () => {
  it("interdit à un gérant Zogbo de demander Gbégamey", () => {
    const r = resolveAnalyseSite("zogbo", "gbegamey");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("force le site du gérant même si la requête dit « tous »", () => {
    const r = resolveAnalyseSite("zogbo", "tous");
    expect(r).toEqual({ ok: true, site: "zogbo" });
  });

  it("place un compte multi-sites sur un seul site (pas de consolidation)", () => {
    expect(resolveAnalyseSite("tous", null)).toEqual({ ok: true, site: "zogbo" });
    expect(resolveAnalyseSite("tous", "all")).toEqual({ ok: true, site: "zogbo" });
    expect(resolveAnalyseSite("tous", "gbegamey")).toEqual({
      ok: true,
      site: "gbegamey",
    });
  });

  it("rejette un site inconnu", () => {
    const r = resolveAnalyseSite("tous", "paris");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe("santé et insights", () => {
  it("signale une baisse de CA relative, pas un montant isolé", () => {
    const health = buildHealth(
      totals({ caNet: 700_000, cmv: 200_000, margeBrute: 500_000 }),
      totals({ caNet: 1_000_000, cmv: 250_000, margeBrute: 750_000 }),
      false,
    );
    const commercial = health.find((h) => h.key === "commercial");
    expect(commercial?.tone).toBe("risque");
    expect(commercial?.summary).toMatch(/baisse/i);
  });

  it("n’invente pas de tendance CA si le filtre équipe/nature est actif", () => {
    const health = buildHealth(
      totals({ caNet: 100 }),
      totals({ caNet: 200 }),
      true,
    );
    expect(health[0]?.tone).toBe("indetermine");
  });

  it("rappelle G8 dans les conseils si des achats stock existent", () => {
    const report = buildAnalyseReport({
      window: analyseWindow("month", "2026-08-24"),
      current: totals({ caNet: 800_000, achatsStock: 120_000, cmv: 200_000, margeBrute: 600_000 }),
      previous: totals({ caNet: 750_000, cmv: 190_000, margeBrute: 560_000 }),
      products: rankProducts(
        [
          product({
            productId: "a",
            name: "Alloco",
            kind: "local",
            qty: 20,
            caNet: 40_000,
            caBrut: 40_000,
          }),
        ],
        [
          product({
            productId: "a",
            name: "Alloco",
            kind: "local",
            qty: 18,
            caNet: 36_000,
            caBrut: 36_000,
          }),
        ],
      ),
      byKind: [],
      bySite: [],
      byShift: [],
      filteredCa: false,
    });
    expect(report.conseils.some((c) => c.id === "g8")).toBe(true);
    expect(report.limitations.some((l) => l.includes("G8"))).toBe(true);
  });

  it("alerte sur des remises POS élevées en % du brut", () => {
    const report = buildAnalyseReport({
      window: analyseWindow("week", "2026-08-24"),
      current: totals({ caBrut: 1_000_000, remises: 120_000, caNet: 880_000 }),
      previous: totals({ caBrut: 1_000_000, remises: 20_000, caNet: 980_000 }),
      products: [],
      byKind: [],
      bySite: [],
      byShift: [],
      filteredCa: false,
    });
    expect(report.watches.some((w) => w.id === "remises")).toBe(true);
  });
});
