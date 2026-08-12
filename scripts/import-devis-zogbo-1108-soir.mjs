/**
 * Import devis Zogbo — soirée du 11/08/2026 (CA 5 700 F).
 * Source distincte du matin pour ne pas écraser les devis 230–233.
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-devis-zogbo-1108-soir.mjs --dry-run
 *   node --env-file=.env.local scripts/import-devis-zogbo-1108-soir.mjs --yes
 *
 * Mapping :
 *   Petite Chill 400 F → drink-chill-pm
 *   Petit Youki Pamplemousse 300 F → drink-pamplemousse-pb
 *   Lager 800 F → drink-lager-gb
 *   Pils 800 F → drink-pils-gm
 *   Haslé 600 F → drink-hagbe-gb
 */
import { MongoClient, ObjectId } from "mongodb";

const SOURCE = "devis-zogbo-soir";
const SITE = "zogbo";
const DATE = "2026-08-11";
const EXPECTED_CA = 5700;
const EXPECTED_UNITS = 9;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}

/** Lignes regroupées — prix réels du ticket soir. */
const SALES = [
  {
    kind: "boisson",
    productId: "drink-chill-pm",
    name: "Petite Chill (Chill PM)",
    qty: 2,
    unitPrice: 400,
  },
  {
    kind: "boisson",
    productId: "drink-pamplemousse-pb",
    name: "Petit Youki Pamplemousse (PB)",
    qty: 1,
    unitPrice: 300,
  },
  {
    kind: "boisson",
    productId: "drink-lager-gb",
    name: "Lager GB",
    qty: 4,
    unitPrice: 800,
  },
  {
    kind: "boisson",
    productId: "drink-pils-gm",
    name: "Pils GM",
    qty: 1,
    unitPrice: 800,
  },
  {
    kind: "boisson",
    productId: "drink-hagbe-gb",
    name: "Haslé GB",
    qty: 1,
    unitPrice: 600,
  },
];

function at(hh, mm = 0) {
  const p = (n) => String(n).padStart(2, "0");
  return `${DATE}T${p(hh)}:${p(mm)}:00.000+01:00`;
}

function sumCa(lines) {
  return lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
}

function sumQty(lines) {
  return lines.reduce((s, l) => s + l.qty, 0);
}

async function syncBoissonSoldFromJournal(db, date, productIds) {
  const col = db.collection("boissons_jours");
  const existing = await col.findOne({ _id: date });
  const parametres = await db.collection("parametres").findOne({ _id: "parametres" });
  const byId = new Map((existing?.lines ?? []).map((l) => [l.productId, { ...l }]));

  for (const d of parametres?.drinks ?? []) {
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

  for (const productId of productIds) {
    const rows = await db
      .collection("ventes_log")
      .aggregate([
        {
          $match: {
            date,
            site: SITE,
            kind: "boisson",
            productId,
            cancelledAt: null,
            caExcluded: { $ne: true },
          },
        },
        { $group: { _id: null, qty: { $sum: "$qty" } } },
      ])
      .toArray();
    const line = byId.get(productId);
    if (line) line.soldZogbo = rows[0]?.qty ?? 0;
  }

  await col.replaceOne(
    { _id: date },
    {
      _id: date,
      status: existing?.status ?? "cloturee",
      lines: [...byId.values()],
      movements: existing?.movements ?? [],
      updatedAt: new Date().toISOString(),
      source: existing?.source ?? SOURCE,
      rev: (existing?.rev ?? 0) + 1,
    },
    { upsert: true },
  );
}

async function main() {
  const ca = sumCa(SALES);
  const units = sumQty(SALES);
  if (ca !== EXPECTED_CA) {
    throw new Error(`CA total ${ca} ≠ attendu ${EXPECTED_CA}`);
  }
  if (units !== EXPECTED_UNITS) {
    throw new Error(`Unités ${units} ≠ attendu ${EXPECTED_UNITS}`);
  }

  const boissonIds = SALES.filter((l) => l.kind === "boisson").map(
    (l) => l.productId,
  );

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          date: DATE,
          site: SITE,
          source: SOURCE,
          ca,
          units,
          lignes: SALES,
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
  if (!parametres) throw new Error("parametres manquants");

  const drinkIds = new Set((parametres.drinks ?? []).map((d) => d.id));
  for (const line of SALES) {
    if (line.productId && !drinkIds.has(line.productId)) {
      throw new Error(`Produit introuvable : ${line.productId} (${line.name})`);
    }
  }

  await db.collection("ventes_log").deleteMany({ date: DATE, source: SOURCE });

  const ventes = [];
  let h = 19;
  let m = 0;
  for (const line of SALES) {
    const slug = line.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);
    ventes.push({
      _id: new ObjectId(),
      date: DATE,
      site: SITE,
      kind: line.kind,
      productId: line.productId ?? `extra-${slug}`,
      name: line.name,
      qty: line.qty,
      unitPrice: line.unitPrice,
      costPrice: 0,
      amount: line.qty * line.unitPrice,
      at: at(h, m),
      cancelledAt: null,
      caExcluded: false,
      shift: "nuit",
      source: SOURCE,
    });
    m += 5;
    if (m >= 60) {
      m = 0;
      h += 1;
    }
  }

  if (ventes.length) await db.collection("ventes_log").insertMany(ventes);
  await syncBoissonSoldFromJournal(db, DATE, boissonIds);

  console.log(
    JSON.stringify(
      {
        dryRun,
        date: DATE,
        site: SITE,
        source: SOURCE,
        ca,
        units,
        lignes: ventes.length,
        boissonsSync: boissonIds,
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
