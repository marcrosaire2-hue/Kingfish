/**
 * Efface les stocks de vente : supprime tous les documents « jour » des
 * collections Zogbo / Gbégamey / combos / boissons, toutes dates confondues,
 * puis écrit une journée à zéro pour la date courante.
 *
 * Sans cette journée à zéro, l’appli recrée le jour au premier affichage en
 * reportant le stock d’ouverture AquaPro (voir src/lib/aquapro-opening-stock.ts).
 *
 * Le journal des ventes (ventes_log) n’est PAS touché.
 *
 * Usage:
 *   node --env-file=.env.local scripts/reset-stocks-vente.mjs --dry-run
 *   node --env-file=.env.local scripts/reset-stocks-vente.mjs --yes
 *   DATE=2026-08-11 node --env-file=.env.local scripts/reset-stocks-vente.mjs --yes
 */
import { MongoClient } from "mongodb";

const COLLECTIONS = [
  "zogbo_jours",
  "gbegamey_jours",
  "combos_jours",
  "boissons_jours",
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const confirmed = args.has("--yes");

if (!dryRun && !confirmed) {
  console.error("Refus : passez --yes pour supprimer, ou --dry-run pour compter.");
  process.exit(1);
}

const date = process.env.DATE || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`DATE invalide : ${date} (attendu YYYY-MM-DD)`);
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI manquant (utilisez --env-file=.env.local).");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");

for (const name of COLLECTIONS) {
  const col = db.collection(name);
  const before = await col.countDocuments({});
  if (dryRun) {
    console.log(`${name} : ${before} document(s) à supprimer`);
    continue;
  }
  const res = await col.deleteMany({});
  console.log(`${name} : ${res.deletedCount}/${before} document(s) supprimé(s)`);
}

const parametres = (await db.collection("parametres").findOne({})) ?? {};
const baseDishes = parametres.baseDishes ?? [];
const localDishes = parametres.localDishes ?? [];
const combos = parametres.combos ?? [];
const drinks = parametres.drinks ?? [];

const updatedAt = new Date().toISOString();
const day = {
  zogbo_jours: {
    _id: date,
    status: "ouverte",
    lines: baseDishes.map((d) => ({
      productId: d.id,
      name: d.name,
      stock: 0,
      prepared: 0,
      sentToGbegamey: 0,
      sold: 0,
      counted: null,
      observations: "",
    })),
    movements: [],
    updatedAt,
    source: "reset-stocks-vente",
  },
  gbegamey_jours: {
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
    source: "reset-stocks-vente",
  },
  combos_jours: {
    _id: date,
    status: "ouverte",
    lines: combos.map((c) => ({
      productId: c.id,
      name: c.name,
      baseDishName: c.baseDishName ?? null,
      stockZogbo: 0,
      prepared: 0,
      sentToGbegamey: 0,
      soldZogbo: 0,
      countedZogbo: null,
      initialGbegamey: 0,
      soldGbegamey: 0,
      countedGbegamey: null,
      observations: "",
    })),
    movements: [],
    updatedAt,
    source: "reset-stocks-vente",
  },
  boissons_jours: {
    _id: date,
    status: "ouverte",
    lines: drinks.map((d) => ({
      productId: d.id,
      name: d.name,
      initialStock: 0,
      purchases: 0,
      soldZogbo: 0,
      soldGbegamey: 0,
      counted: null,
      observations: "",
    })),
    movements: [],
    updatedAt,
    source: "reset-stocks-vente",
  },
};

for (const [name, doc] of Object.entries(day)) {
  const count = (doc.lines ?? doc.transferLines ?? []).length;
  if (dryRun) {
    console.log(`${name} : journée ${date} à zéro (${count} ligne(s)) — simulation`);
    continue;
  }
  await db.collection(name).replaceOne({ _id: date }, doc, { upsert: true });
  console.log(`${name} : journée ${date} écrite à zéro (${count} ligne(s))`);
}

const ventes = await db.collection("ventes_log").countDocuments({});
console.log(`ventes_log : ${ventes} ligne(s) conservée(s) (non touché)`);

await client.close();
