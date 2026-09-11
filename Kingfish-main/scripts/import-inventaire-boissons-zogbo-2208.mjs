/**
 * Inventaire boissons Zogbo — 22/08/2026, avant vente.
 * Comptage physique de bouteilles pleines par marque (cahier PDF fourni),
 * appliqué au champ `counted` de chaque ligne boissons_jours du jour.
 *
 * N'écrit QUE `counted` + `observations` sur les lignes concernées — jamais
 * `initialStock` / `purchases` / `soldZogbo` / `soldGbegamey` / `pertes`,
 * qui restent celles déjà enregistrées (mêmes garanties que la sauvegarde
 * normale de l'écran Boissons, cf. `saveBoissonsDay` avec `lockSold` par
 * défaut). Les lignes hors inventaire (produits non listés au cahier) ne
 * sont pas touchées.
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-inventaire-boissons-zogbo-2208.mjs --dry-run
 *   node --env-file=.env.local scripts/import-inventaire-boissons-zogbo-2208.mjs --yes
 */
import { MongoClient } from "mongodb";

const DATE = "2026-08-22";
const SOURCE = "inventaire-boissons-zogbo-2208";
const EXPECTED_PETITES = 90;
const EXPECTED_GRANDES = 66;
const EXPECTED_TOTAL = 156;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}

/** Petites bouteilles (cahier §2/§5, table "Petites bouteilles – 90") */
const PETITES = [
  { productId: "drink-guinness-pm", marque: "Guinness", counted: 15 },
  { productId: "drink-pamplemousse-pb", marque: "Pamplemousse", counted: 12 },
  { productId: "drink-cokteil-pb", marque: "Cocktail", counted: 12 },
  { productId: "drink-moka-pb", marque: "Moka", counted: 8 },
  { productId: "drink-coca-cola-pb", marque: "Coca", counted: 7 },
  { productId: "drink-youzou-sprite-pb", marque: "Youzou", counted: 6 },
  { productId: "drink-beninoise-pb", marque: "Béninoise", counted: 11 },
  { productId: "drink-beaufort-pb", marque: "Beaufort", counted: 15 },
  { productId: "drink-xxl-pb", marque: "XXL", counted: 4 },
];

/** Grandes bouteilles (cahier §2/§5, table "Grandes bouteilles – 66") */
const GRANDES = [
  { productId: "drink-castel-gb", marque: "Castel", counted: 10 },
  { productId: "drink-lager-gb", marque: "Lager", counted: 7 },
  { productId: "drink-flag-gb", marque: "Flag", counted: 9 },
  { productId: "drink-kankpe-gb", marque: "Kankpé", counted: 0 },
  { productId: "drink-doppel-gb", marque: "Doppel", counted: 0 },
  { productId: "drink-chill-gb", marque: "Chill", counted: 0 },
  { productId: "drink-hagbe-gb", marque: "Hagbé", counted: 11 },
  { productId: "drink-beaufort-gb", marque: "Beaufort", counted: 9 },
  { productId: "drink-moka-gb", marque: "Moka", counted: 1 },
  { productId: "drink-coca-cola-gb", marque: "Coca", counted: 2 },
  { productId: "drink-cokteil-gb", marque: "Cocktail", counted: 2 },
  { productId: "drink-pamplemousse-gb", marque: "Pamplemousse", counted: 2 },
  { productId: "drink-youzou-sprite-gb", marque: "Youzou", counted: 4 },
  { productId: "drink-beninoise-gb", marque: "Béninoise", counted: 9 },
  { productId: "drink-pils-gm", marque: "Pils", counted: 0 },
];

const LINES = [...PETITES, ...GRANDES];

function emptyLine(productId, name) {
  return {
    productId,
    name,
    initialStock: 0,
    purchases: 0,
    soldZogbo: 0,
    soldGbegamey: 0,
    pertes: 0,
    counted: null,
    observations: "",
  };
}

async function main() {
  const totalPetites = PETITES.reduce((s, l) => s + l.counted, 0);
  const totalGrandes = GRANDES.reduce((s, l) => s + l.counted, 0);
  const total = totalPetites + totalGrandes;
  if (totalPetites !== EXPECTED_PETITES) {
    throw new Error(`Petites bouteilles ${totalPetites} ≠ ${EXPECTED_PETITES}`);
  }
  if (totalGrandes !== EXPECTED_GRANDES) {
    throw new Error(`Grandes bouteilles ${totalGrandes} ≠ ${EXPECTED_GRANDES}`);
  }
  if (total !== EXPECTED_TOTAL) {
    throw new Error(`Total ${total} ≠ ${EXPECTED_TOTAL}`);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");

  const parametres = await db
    .collection("parametres")
    .findOne({ _id: "parametres" });
  if (!parametres?.drinks?.length) throw new Error("parametres.drinks manquants");
  const drinkById = new Map(parametres.drinks.map((d) => [d.id, d]));
  for (const l of LINES) {
    if (!drinkById.has(l.productId)) {
      throw new Error(`Boisson introuvable au catalogue : ${l.productId} (${l.marque})`);
    }
  }

  const existing = await db.collection("boissons_jours").findOne({ _id: DATE });
  const byId = new Map(
    (existing?.lines ?? []).map((l) => [l.productId, { ...l }]),
  );

  const preview = [];
  for (const l of LINES) {
    const drink = drinkById.get(l.productId);
    const prev = byId.get(l.productId) ?? emptyLine(l.productId, drink.name);
    const nextLine = {
      ...prev,
      name: drink.name,
      counted: l.counted,
      observations: `Inventaire physique Zogbo ${DATE} avant vente (${l.marque})`,
    };
    byId.set(l.productId, nextLine);
    preview.push({
      productId: l.productId,
      name: drink.name,
      marqueCahier: l.marque,
      counted: l.counted,
      soldZogboConserve: prev.soldZogbo ?? 0,
      soldGbegameyConserve: prev.soldGbegamey ?? 0,
    });
  }

  if (dryRun) {
    console.log(
      JSON.stringify(
        { dryRun: true, date: DATE, source: SOURCE, totalPetites, totalGrandes, total, lignes: preview },
        null,
        2,
      ),
    );
    await client.close();
    return;
  }

  const lines = [...byId.values()];
  await db.collection("boissons_jours").updateOne(
    { _id: DATE },
    {
      $set: {
        status: existing?.status ?? "ouverte",
        lines,
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        rev: (existing?.rev ?? 0) + 1,
      },
      $setOnInsert: { _id: DATE, movements: [] },
    },
    { upsert: true },
  );

  console.log(
    JSON.stringify(
      { dryRun: false, date: DATE, source: SOURCE, totalPetites, totalGrandes, total, lignesMisesAJour: preview.length, lignes: preview },
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
