/**
 * Supprime les données restantes de Gbégamey : le stock (gbegamey_jours)
 * et les entrées d'audit (historique site "gbegamey").
 *
 * Le document jour est supprimé puis réécrit à zéro pour la date courante,
 * sinon l'appli recrée le stock via le fallback AquaPro au premier affichage
 * (voir src/lib/aquapro-opening-stock.ts).
 *
 * Usage:
 *   node --env-file=.env.local scripts/supprimer-donnees-gbegamey.mjs --dry-run
 *   node --env-file=.env.local scripts/supprimer-donnees-gbegamey.mjs --yes
 */
import { MongoClient } from "mongodb";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const confirmed = args.has("--yes");

if (!dryRun && !confirmed) {
  console.error("Refus : passez --yes pour supprimer, ou --dry-run pour compter.");
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
if (!uri || !dbName) {
  console.error("MONGODB_URI et MONGODB_DB requis (.env.local).");
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const gbegameyCol = db.collection("gbegamey_jours");
const historiqueCol = db.collection("historique");

const gCount = await gbegameyCol.countDocuments({});
const hCount = await historiqueCol.countDocuments({ site: "gbegamey" });
console.log(`gbegamey_jours : ${gCount} document(s) à supprimer`);
console.log(`historique (site gbegamey) : ${hCount} entrée(s) à supprimer`);

if (dryRun) {
  console.log("Simulation (--yes pour appliquer).");
  await client.close();
  process.exit(0);
}

const gRes = await gbegameyCol.deleteMany({});
const hRes = await historiqueCol.deleteMany({ site: "gbegamey" });
console.log(
  `Supprimés : ${gRes.deletedCount} jour(s), ${hRes.deletedCount} entrée(s) d'historique.`,
);

const parametres = (await db.collection("parametres").findOne({})) ?? {};
const baseDishes = parametres.baseDishes ?? [];
const localDishes = parametres.localDishes ?? [];

const updatedAt = new Date().toISOString();
const zeroDay = {
  _id: date,
  status: "ouverte",
  transferLines: baseDishes.map((d) => ({
    productId: d.id,
    name: d.name,
    initialStock: 0,
    received: null,
    sold: 0,
    counted: null,
    observations: "",
  })),
  localLines: localDishes.map((d) => ({
    productId: d.id,
    name: d.name,
    initialStock: 0,
    prepared: 0,
    sold: 0,
    counted: null,
    observations: "",
  })),
  updatedAt,
  source: "suppression-donnees-gbegamey",
};
await gbegameyCol.replaceOne({ _id: date }, zeroDay, { upsert: true });
console.log(`Journée ${date} réécrite à zéro (garde le stock vide).`);

await client.close();