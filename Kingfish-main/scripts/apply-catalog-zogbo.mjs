/**
 * Applique le catalogue plats + accompagnements Zogbo (nouvelles ventes).
 * Conserve boissons, matières et recettes existantes.
 *
 * Usage:
 *   node --env-file=.env.local scripts/apply-catalog-zogbo.mjs --dry-run
 *   node --env-file=.env.local scripts/apply-catalog-zogbo.mjs --yes
 */
import { MongoClient } from "mongodb";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}

/** Aligné sur src/lib/catalog-zogbo.ts */
const baseDishes = [
  {
    id: "base-sauce-tomate-poisson-frais",
    name: "Sauce tomate au poisson frais",
    unitPrice: 1000,
  },
  { id: "base-sauce-d-arachide", name: "Sauce d'arachide", unitPrice: 1000 },
  {
    id: "base-sauce-legumes-tchiayo-gboman",
    name: "Sauce légumes",
    unitPrice: 1000,
  },
  { id: "base-sauce-graine", name: "Sauce graine", unitPrice: 1000 },
  {
    id: "base-sauce-tchiayo-broye",
    name: "Sauce tchayo broyé (mouton & fromage)",
    unitPrice: 1000,
  },
  {
    id: "base-sauce-monyo-au-poisson-fume",
    name: "Sauce monyo",
    unitPrice: 1000,
  },
  { id: "base-poisson-pane", name: "Poisson pané", unitPrice: 1000 },
];

const localDishes = [
  { id: "local-pate-de-mais", name: "Pâte de maïs", unitPrice: 500 },
  {
    id: "local-telibo",
    name: "Pâte télibo (causette d'igname)",
    unitPrice: 500,
  },
  { id: "local-piron-blanc", name: "Piron blanc", unitPrice: 500 },
  { id: "local-piron-rouge", name: "Piron rouge", unitPrice: 500 },
  { id: "local-akassa", name: "Akassa", unitPrice: 500 },
  { id: "local-riz", name: "Riz", unitPrice: 500 },
  {
    id: "local-couscous-fonio",
    name: "Couscous de fonio sans gluten",
    unitPrice: 500,
  },
  { id: "local-blanc", name: "Blanc", unitPrice: 500 },
  { id: "local-frites", name: "Frites", unitPrice: 1000 },
  { id: "local-legume-saute", name: "Légumes sautés", unitPrice: 1000 },
  {
    id: "local-pommes-de-terre-sautees",
    name: "Pommes de terre sautées",
    unitPrice: 1000,
  },
  { id: "local-spaghetti", name: "Spaghetti", unitPrice: 1000 },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");
  const existing = await db.collection("parametres").findOne({ _id: "parametres" });

  const next = {
    baseDishes,
    localDishes,
    combos: [],
    drinks: existing?.drinks ?? [],
    rawMaterials: existing?.rawMaterials ?? [],
    recipes: existing?.recipes ?? [],
    updatedAt: new Date().toISOString(),
  };

  if (!dryRun) {
    await db.collection("parametres").updateOne(
      { _id: "parametres" },
      { $set: next },
      { upsert: true },
    );
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        plats: baseDishes.length,
        accompagnements: localDishes.length,
        combos: 0,
        boissonsConservees: next.drinks.length,
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
