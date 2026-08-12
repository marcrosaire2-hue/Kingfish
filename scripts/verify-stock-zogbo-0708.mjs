/**
 * Vérifie inventaire Zogbo 07/08 vs comptage utilisateur
 * et stock final jour par jour (08→12).
 *
 * Usage: node scripts/verify-stock-zogbo-0708.mjs
 */
const EXCEL = [
  { name: "Attasi", prepared: 100, sent: 55, sold: 23, counted: 19 },
  { name: "Brochette de poisson", prepared: 67, sent: 21, sold: 4, counted: 21 },
  { name: "Choucouya", prepared: 31, sent: 10, sold: 0, counted: 7 },
  { name: "Friture", prepared: 50, sent: 55, sold: 0, counted: 21 },
  { name: "Poisson Chawarma", prepared: 120, sent: 75, sold: 4, counted: 38 },
  { name: "Poisson pané", prepared: 49, sent: 30, sold: 4, counted: 0 },
  { name: "Sauce arachide", prepared: 50, sent: 13, sold: 2, counted: 16 },
  { name: "Sauce graine", prepared: 50, sent: 33, sold: 14, counted: 8 },
  { name: "Sauce légume", prepared: 41, sent: 20, sold: 4, counted: 10 },
  { name: "Sauce Monyo", prepared: 86, sent: 65, sold: 9, counted: 5 },
  { name: "Sauce Tchayo", prepared: 50, sent: 25, sold: 4, counted: 19 },
  { name: "Sauce tomate", prepared: 96, sent: 58, sold: 7, counted: 18 },
];

/** Comptage verbal utilisateur (après inventaire 07/08). */
const USER = {
  Attasi: 19,
  "Brochette de poisson": 27,
  Choucouya: 7,
  Friture: 21,
  "Poisson Chawarma": 21,
  "Poisson pané": 38,
  "Sauce arachide": 0,
  "Sauce graine": 16,
  "Sauce légume": 8,
  "Sauce Monyo": 10,
  "Sauce Tchayo": 5,
  "Sauce tomate": 18,
};

/**
 * Sorties plats Zogbo après le 07/08 (carnet + devis, décomposés).
 * Les ventes du 07 ne sont PAS déduites à nouveau : le compté = stock départ 08.
 */
const SORTIES = {
  "2026-08-08": {
    "Sauce arachide": 3, // 2×(arachide+riz) + 1 plat arachide
    "Sauce graine": 1,
    "Sauce légume": 1,
    "Sauce poisson frais": 8, // ambigu → souvent Monyo
  },
  "2026-08-09": {},
  "2026-08-10": {
    "Sauce Monyo": 2, // Monyo + Piron ×2
  },
  "2026-08-11": {
    // Devis matin (extras repas)
    "Sauce légume": 1, // plat sauce légume + Tilézo
    Attasi: 2, // 2× plat d'atassi
    "Sauce arachide": 1, // arachide + Tilézo
  },
  "2026-08-12": {},
};

function theorique(row) {
  return row.prepared - row.sent - row.sold;
}

function main() {
  console.log("=== 1. INVENTAIRE 07/08 : Excel vs vous vs théorique ===\n");
  console.log(
    [
      "Plat".padEnd(22),
      "Préparé".padStart(8),
      "Envoyé".padStart(7),
      "Vendu7".padStart(7),
      "Théo".padStart(6),
      "Excel".padStart(6),
      "Vous".padStart(6),
      "Δvous".padStart(6),
    ].join(" "),
  );

  const rows = EXCEL.map((r) => {
    const th = theorique(r);
    const user = USER[r.name] ?? null;
    const delta = user === null ? null : user - r.counted;
    console.log(
      [
        r.name.slice(0, 22).padEnd(22),
        String(r.prepared).padStart(8),
        String(r.sent).padStart(7),
        String(r.sold).padStart(7),
        String(th).padStart(6),
        String(r.counted).padStart(6),
        String(user ?? "—").padStart(6),
        String(delta ?? "—").padStart(6),
      ].join(" "),
    );
    return { ...r, th, user, delta };
  });

  const mismatches = rows.filter((r) => r.delta !== 0 && r.delta !== null);
  console.log(
    `\nÉcarts Excel ↔ vous : ${mismatches.length}/${rows.length} plats`,
  );
  for (const m of mismatches) {
    console.log(`  · ${m.name}: Excel ${m.counted} → vous ${m.user} (Δ ${m.delta})`);
  }

  // Hypothèse lecture décalée
  console.log("\n=== 2. HYPOTHÈSE : permutation / décalage de lecture ===");
  console.log(
    "Excel Chawarma=38 / Pané=0  vs  vous Charrois=21 / Panés=38 → swap probable Chawarma↔Pané + autre erreur brochette.",
  );
  console.log(
    "Sauces Excel [16,8,10,5,19,18] vs vous [0,16,8,10,5,18] → arachide forcée à 0 puis décalage d’une case (tchayo 19 perdu).",
  );

  console.log("\n=== 3. STOCK FINAL JOUR PAR JOUR (départ = compté Excel) ===\n");
  console.log("Règle : stock_08_matin = counted Excel (ventes du 7 déjà dans l’écart inventaire).");

  const stock = Object.fromEntries(rows.map((r) => [r.name, r.counted]));
  // Alias for sauce poisson frais → track separately then note
  stock["Sauce poisson frais"] = 0;

  const dates = [
    "2026-08-08",
    "2026-08-09",
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
  ];

  for (const date of dates) {
    const out = SORTIES[date] ?? {};
    for (const [name, qty] of Object.entries(out)) {
      if (stock[name] === undefined) stock[name] = 0;
      stock[name] -= qty;
    }
    console.log(`--- Fin ${date} ---`);
    for (const r of rows) {
      const s = stock[r.name];
      const sold = out[r.name] ?? 0;
      if (sold || s !== r.counted) {
        console.log(
          `  ${r.name.padEnd(22)} vendu ${String(sold).padStart(3)} → reste ${s}`,
        );
      }
    }
    if (out["Sauce poisson frais"]) {
      console.log(
        `  Sauce poisson frais   vendu ${String(out["Sauce poisson frais"]).padStart(3)} (non mappé catalogue — à imputer sur Monyo/Tomate ?)`,
      );
    }
  }

  console.log("\n=== 4. MÊME CALCUL AVEC VOTRE COMPTAGE ===\n");
  const stockU = { ...USER, "Sauce poisson frais": 0 };
  for (const date of dates) {
    const out = SORTIES[date] ?? {};
    for (const [name, qty] of Object.entries(out)) {
      if (stockU[name] === undefined) stockU[name] = 0;
      stockU[name] -= qty;
    }
  }
  console.log("Reste théorique au soir du 12/08 (départ = votre comptage) :");
  for (const name of Object.keys(USER)) {
    console.log(`  ${name.padEnd(22)} ${stockU[name]}`);
  }
  if (SORTIES["2026-08-08"]["Sauce poisson frais"]) {
    console.log(
      `  (et -${SORTIES["2026-08-08"]["Sauce poisson frais"]} Sauce poisson frais non résolue le 08/08)`,
    );
  }
}

main();
