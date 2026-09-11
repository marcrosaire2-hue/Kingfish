/**
 * Inventaire boissons Zogbo — 12/08/2026
 * Cahier (stock avant) + facture (réception) → stock théorique.
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-inventaire-boissons-zogbo-1208.mjs --dry-run
 *   node --env-file=.env.local scripts/import-inventaire-boissons-zogbo-1208.mjs --yes
 */
import { MongoClient } from "mongodb";

const DATE = "2026-08-12";
const SOURCE = "inventaire-boissons-zogbo-1208";
const EXPECTED_CAHIER = 58;
const EXPECTED_FACTURE = 120;
const EXPECTED_TOTAL = 178;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}

/**
 * Stock en bouteilles.
 * initial = cahier avant réception
 * purchases = facture (reçues)
 * UPC catalogue pour convertir en casiers (formule app).
 */
const LINES = [
  {
    productId: "drink-beninoise-pb",
    name: "Béninoise 33CL (PB)",
    upc: 24,
    initialBottles: 3,
    purchaseBottles: 6,
  },
  {
    productId: "drink-youzou-sprite-pb",
    name: "Youki / Youzou 33CL (PB)",
    upc: 24,
    initialBottles: 9,
    purchaseBottles: 24,
    note: "Youki Coca cahier + Youki 33CL facture",
  },
  {
    productId: "drink-lager-gb",
    name: "Pils Lager Togo 66CL",
    upc: 12,
    initialBottles: 2,
    purchaseBottles: 12,
    note: "Lager cahier → Pils Lager facture",
  },
  {
    productId: "drink-guinness-pm",
    name: "Guinness",
    upc: 24,
    initialBottles: 6,
    purchaseBottles: 0,
  },
  {
    productId: "drink-chill-pm",
    name: "Chill (petite)",
    upc: 24,
    initialBottles: 2,
    purchaseBottles: 0,
  },
  {
    productId: "drink-pamplemousse-pb",
    name: "Coca Pamplemousse (PB)",
    upc: 24,
    initialBottles: 2,
    purchaseBottles: 0,
  },
  {
    productId: "drink-fifa-pb",
    name: "Fayza → FIFA PB",
    upc: 24,
    initialBottles: 6,
    purchaseBottles: 0,
    note: "Libellé cahier Fayza",
  },
  {
    productId: "drink-moka-pb",
    name: "Table Meka → Moka PB",
    upc: 24,
    initialBottles: 12,
    purchaseBottles: 0,
  },
  {
    productId: "drink-youzou-sprite-gb",
    name: "Yooky → Youzou Sprite GB",
    upc: 12,
    initialBottles: 5,
    purchaseBottles: 0,
    note: "Libellé cahier Yooky (à confirmer)",
  },
  {
    productId: "drink-xxl-pb",
    name: "XXL",
    upc: 24,
    initialBottles: 10,
    purchaseBottles: 0,
  },
  {
    productId: "drink-fifa-gb",
    name: "Fija → FIFA GB",
    upc: 12,
    initialBottles: 1,
    purchaseBottles: 0,
    note: "Libellé cahier Fija (à confirmer)",
  },
  {
    productId: "drink-hagbe-gb",
    name: "HAGBE",
    upc: 12,
    initialBottles: 0,
    purchaseBottles: 12,
  },
  {
    productId: "drink-pils-gm",
    name: "Pils Togo 66CL",
    upc: 24,
    initialBottles: 0,
    purchaseBottles: 12,
    note: "Facture ×12 ; catalogue UPC 24 → 0,5 casier",
  },
  {
    productId: "drink-kankpe-gb",
    name: "Béninoise Kankpé 66CL",
    upc: 12,
    initialBottles: 0,
    purchaseBottles: 12,
  },
  {
    productId: "drink-beninoise-gb",
    name: "Béninoise 66CL",
    upc: 12,
    initialBottles: 0,
    purchaseBottles: 12,
  },
  {
    productId: "drink-beaufort-gb",
    name: "Beaufort 50CL (GB)",
    upc: 12,
    initialBottles: 0,
    purchaseBottles: 12,
  },
  {
    productId: "drink-contesse-fruit",
    name: "Sucrerie 66CL → Contesse Fruit",
    upc: 24,
    initialBottles: 0,
    purchaseBottles: 12,
    note: "Mapping Sucrerie → Contesse (à confirmer)",
  },
  {
    productId: "drink-beaufort-pb",
    name: "Beaufort 33CL (PB)",
    upc: 24,
    initialBottles: 0,
    purchaseBottles: 6,
    note: "Facture 0,5×12 ; catalogue UPC 24 → 0,25 casier",
  },
];

function bottlesToCasiers(bottles, upc) {
  return Math.round((bottles / upc) * 1000) / 1000;
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function main() {
  const cahier = LINES.reduce((s, l) => s + l.initialBottles, 0);
  const facture = LINES.reduce((s, l) => s + l.purchaseBottles, 0);
  const total = cahier + facture;

  if (cahier !== EXPECTED_CAHIER) {
    throw new Error(`Cahier ${cahier} ≠ ${EXPECTED_CAHIER}`);
  }
  if (facture !== EXPECTED_FACTURE) {
    throw new Error(`Facture ${facture} ≠ ${EXPECTED_FACTURE}`);
  }
  if (total !== EXPECTED_TOTAL) {
    throw new Error(`Total ${total} ≠ ${EXPECTED_TOTAL}`);
  }

  const preview = LINES.map((l) => {
    const initC = bottlesToCasiers(l.initialBottles, l.upc);
    const purchC = bottlesToCasiers(l.purchaseBottles, l.upc);
    return {
      productId: l.productId,
      name: l.name,
      initialBottles: l.initialBottles,
      purchaseBottles: l.purchaseBottles,
      totalBottles: l.initialBottles + l.purchaseBottles,
      upc: l.upc,
      initialStockCasiers: initC,
      purchasesCasiers: purchC,
      note: l.note ?? null,
    };
  });

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          date: DATE,
          source: SOURCE,
          cahier,
          facture,
          total,
          lignes: preview,
        },
        null,
        2,
      ),
    );
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");
  const parametres = await db.collection("parametres").findOne({ _id: "parametres" });
  if (!parametres?.drinks?.length) throw new Error("parametres.drinks manquants");

  const drinkById = new Map(parametres.drinks.map((d) => [d.id, d]));
  for (const l of LINES) {
    if (!drinkById.has(l.productId)) {
      throw new Error(`Boisson introuvable : ${l.productId}`);
    }
  }

  const existing = await db.collection("boissons_jours").findOne({ _id: DATE });
  const byId = new Map(
    (existing?.lines ?? []).map((l) => [l.productId, { ...l }]),
  );

  for (const d of parametres.drinks) {
    if (!byId.has(d.id)) {
      byId.set(d.id, {
        productId: d.id,
        name: d.name,
        initialStock: 0,
        purchases: 0,
        soldZogbo: 0,
        soldGbegamey: 0,
        pertes: 0,
        counted: null,
        observations: "",
      });
    }
  }

  // Ventes déjà enregistrées ce jour (à conserver).
  const soldRows = await db
    .collection("ventes_log")
    .aggregate([
      {
        $match: {
          date: DATE,
          kind: "boisson",
          cancelledAt: null,
          caExcluded: { $ne: true },
        },
      },
      {
        $group: {
          _id: { productId: "$productId", site: "$site" },
          qty: { $sum: "$qty" },
        },
      },
    ])
    .toArray();
  const soldZogbo = new Map();
  const soldGbegamey = new Map();
  for (const r of soldRows) {
    if (r._id.site === "zogbo") {
      soldZogbo.set(r._id.productId, r.qty);
    } else if (r._id.site === "gbegamey") {
      soldGbegamey.set(r._id.productId, r.qty);
    }
  }

  const movements = [];
  const at = `${DATE}T08:00:00.000+01:00`;

  for (const l of LINES) {
    const drink = drinkById.get(l.productId);
    const upc = Math.max(1, Number(drink.unitsPerCasier) || l.upc);
    const initC = bottlesToCasiers(l.initialBottles, upc);
    const purchC = bottlesToCasiers(l.purchaseBottles, upc);
    const totalC = Math.round((initC + purchC) * 1000) / 1000;
    const prev = byId.get(l.productId);
    const line = {
      productId: l.productId,
      name: drink.name,
      initialStock: initC,
      purchases: purchC,
      soldZogbo: soldZogbo.get(l.productId) ?? prev?.soldZogbo ?? 0,
      soldGbegamey: soldGbegamey.get(l.productId) ?? prev?.soldGbegamey ?? 0,
      pertes: prev?.pertes ?? 0,
      counted: totalC,
      observations: [
        `Inventaire Zogbo ${DATE}`,
        `cahier ${l.initialBottles} bt`,
        l.purchaseBottles ? `facture +${l.purchaseBottles} bt` : null,
        l.note ?? null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
    byId.set(l.productId, line);

    if (purchC > 0) {
      movements.push({
        id: newId("boi"),
        at,
        type: "purchase",
        productId: l.productId,
        name: drink.name,
        qty: purchC,
        stockAfter: totalC,
        cancelledAt: null,
        source: SOURCE,
      });
    }
  }

  // Produits hors inventaire : garder ventes, stock à 0 si jamais touchés.
  for (const [id, line] of byId) {
    if (LINES.some((l) => l.productId === id)) continue;
    line.soldZogbo = soldZogbo.get(id) ?? line.soldZogbo ?? 0;
    line.soldGbegamey = soldGbegamey.get(id) ?? line.soldGbegamey ?? 0;
  }

  await db.collection("boissons_jours").replaceOne(
    { _id: DATE },
    {
      _id: DATE,
      status: existing?.status ?? "ouverte",
      lines: [...byId.values()],
      movements: [
        ...(existing?.movements ?? []).filter((m) => m.source !== SOURCE),
        ...movements,
      ],
      updatedAt: new Date().toISOString(),
      source: SOURCE,
      rev: (existing?.rev ?? 0) + 1,
    },
    { upsert: true },
  );

  console.log(
    JSON.stringify(
      {
        dryRun: false,
        date: DATE,
        source: SOURCE,
        cahier,
        facture,
        total,
        mouvementsAchat: movements.length,
        lignes: preview,
      },
      null,
      2,
    ),
  );

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
