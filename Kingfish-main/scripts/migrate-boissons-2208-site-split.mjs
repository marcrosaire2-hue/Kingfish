/**
 * Migration ponctuelle du document boissons_jours du 22/08/2026 vers le
 * schéma par site (initialStockZogbo/Gbegamey, purchasesZogbo/Gbegamey,
 * pertesZogbo/Gbegamey, countedZogbo/Gbegamey) introduit pour séparer le
 * stock boissons Zogbo/Gbégamey (avant : un seul pot commun).
 *
 * Ne touche QUE les 24 lignes du comptage physique Zogbo du 22/08 (voir
 * scripts/import-inventaire-boissons-zogbo-2208.mjs) :
 *  - countedZogbo = countedGbegamey = ancien `counted` combiné (le comptage
 *    Zogbo réel devient la valeur Zogbo ; côté Gbégamey, on ne fait que
 *    reporter la même valeur qu'avant cette migration — donc AUCUN
 *    changement visible côté Gbégamey — en attendant un vrai inventaire
 *    physique là-bas). Idem pour initialStock/purchases/pertes.
 * Les 10 autres boissons du catalogue restent en forme héritée : déjà gérées
 * sans risque par le fallback de compatibilité de `normalizeBoissonsLine`.
 *
 * Usage:
 *   node --env-file=.env.local scripts/migrate-boissons-2208-site-split.mjs --dry-run
 *   node --env-file=.env.local scripts/migrate-boissons-2208-site-split.mjs --yes
 */
import { MongoClient } from "mongodb";

const DATE = "2026-08-22";
const PRODUCT_IDS = [
  "drink-guinness-pm",
  "drink-pamplemousse-pb",
  "drink-cokteil-pb",
  "drink-moka-pb",
  "drink-coca-cola-pb",
  "drink-youzou-sprite-pb",
  "drink-beninoise-pb",
  "drink-beaufort-pb",
  "drink-xxl-pb",
  "drink-castel-gb",
  "drink-lager-gb",
  "drink-flag-gb",
  "drink-kankpe-gb",
  "drink-doppel-gb",
  "drink-chill-gb",
  "drink-hagbe-gb",
  "drink-beaufort-gb",
  "drink-moka-gb",
  "drink-coca-cola-gb",
  "drink-cokteil-gb",
  "drink-pamplemousse-gb",
  "drink-youzou-sprite-gb",
  "drink-beninoise-gb",
  "drink-pils-gm",
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");

  const doc = await db.collection("boissons_jours").findOne({ _id: DATE });
  if (!doc) throw new Error(`Document ${DATE} introuvable`);

  const preview = [];
  const nextLines = doc.lines.map((line) => {
    if (!PRODUCT_IDS.includes(line.productId)) return line;
    const initialStock = Math.max(0, Number(line.initialStock) || 0);
    const purchases = Math.max(0, Number(line.purchases) || 0);
    const pertes = Math.max(0, Number(line.pertes) || 0);
    const counted =
      line.counted === null || line.counted === undefined
        ? null
        : Math.max(0, Math.round(Number(line.counted) || 0));

    const migrated = {
      productId: line.productId,
      name: line.name,
      initialStockZogbo: initialStock,
      purchasesZogbo: purchases,
      soldZogbo: Math.max(0, Number(line.soldZogbo) || 0),
      pertesZogbo: pertes,
      countedZogbo: counted,
      // Côté Gbégamey : on reporte la même valeur héritée qu'avant cette
      // migration (rien ne change pour Gbégamey tant qu'un vrai comptage
      // n'y est pas fait) — jamais 0/null inventé, qui bloquerait ses ventes.
      initialStockGbegamey: initialStock,
      purchasesGbegamey: purchases,
      soldGbegamey: Math.max(0, Number(line.soldGbegamey) || 0),
      pertesGbegamey: pertes,
      countedGbegamey: counted,
      observations: String(line.observations ?? ""),
    };
    preview.push({
      productId: line.productId,
      name: line.name,
      countedZogbo: migrated.countedZogbo,
      countedGbegamey: migrated.countedGbegamey,
    });
    return migrated;
  });

  if (dryRun) {
    console.log(
      JSON.stringify({ dryRun: true, date: DATE, migrated: preview }, null, 2),
    );
    await client.close();
    return;
  }

  await db.collection("boissons_jours").updateOne(
    { _id: DATE },
    {
      $set: {
        lines: nextLines,
        updatedAt: new Date().toISOString(),
        rev: (doc.rev ?? 0) + 1,
      },
    },
  );

  console.log(
    JSON.stringify(
      { dryRun: false, date: DATE, lignesMigrees: preview.length, migrated: preview },
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
