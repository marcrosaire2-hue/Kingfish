/**
 * Vide les données d'exploitation de Zogbo : le stock/journal (zogbo_jours)
 * et toutes les entrées marquées site "zogbo" (ventes, tickets, caisses,
 * versements, historique, unités de stock).
 *
 * Jamais touché : `users` (comptes), `gbegamey_jours` et toute entrée dont
 * le site n'est pas "zogbo" (Gbégamey, "tous"), journaux de connexion,
 * documents partagés entre sites (boissons_jours, matieres_jours,
 * combos_jours, pos_counters, caisse_mouvements, aquapro_*, sales).
 *
 * Un export JSON est écrit avant suppression (--export-dir).
 *
 * Usage:
 *   node --env-file=.env.local scripts/vider-donnees-zogbo.mjs --dry-run
 *   node --env-file=.env.local scripts/vider-donnees-zogbo.mjs --yes --export-dir=/chemin
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";

/** collection -> filtre ciblant uniquement Zogbo. */
const TARGETS = {
  zogbo_jours: {},
  historique: { site: "zogbo" },
  ventes_log: { site: "zogbo" },
  pos_tickets: { site: "zogbo" },
  caisses_sessions: { site: "zogbo" },
  versements: { site: "zogbo" },
  stock_units: { site: "zogbo" },
};

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => !a.startsWith("--export-dir=")));
const dryRun = flags.has("--dry-run");
const confirmed = flags.has("--yes");
const exportDir = args
  .find((a) => a.startsWith("--export-dir="))
  ?.slice("--export-dir=".length);

if (!dryRun && !confirmed) {
  console.error("Refus : passez --yes pour supprimer, ou --dry-run pour compter.");
  process.exit(1);
}
if (confirmed && !dryRun && !exportDir) {
  console.error("Refus : --export-dir=... requis avant toute suppression.");
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
if (!uri || !dbName) {
  console.error("MONGODB_URI et MONGODB_DB requis (.env.local).");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

if (exportDir && !dryRun) await mkdir(exportDir, { recursive: true });

let total = 0;
for (const [name, filter] of Object.entries(TARGETS)) {
  const col = db.collection(name);
  const count = await col.countDocuments(filter);

  if (dryRun) {
    console.log(`   ${name.padEnd(20)} ${count} doc(s) à supprimer`);
    total += count;
    continue;
  }

  if (count > 0) {
    const docs = await col.find(filter).toArray();
    await writeFile(
      path.join(exportDir, `${name}.json`),
      JSON.stringify(docs, null, 2),
      "utf8",
    );
  }
  const res = await col.deleteMany(filter);
  total += res.deletedCount;
  console.log(`🗑  ${name.padEnd(20)} ${res.deletedCount}/${count} supprimé(s)`);
}

/**
 * Documents journaliers partagés : seules les colonnes Zogbo sont remises à
 * zéro (achats, ventes, stocks, comptages, pertes, mouvements du site),
 * celles de Gbégamey ne sont pas touchées.
 */
const BOISSONS_ZOGBO_ZERO = {
  initialStockZogbo: 0,
  purchasesZogbo: 0,
  soldZogbo: 0,
  pertesZogbo: 0,
  countedZogbo: null,
};
const COMBOS_ZOGBO_ZERO = {
  stockZogbo: 0,
  prepared: 0,
  sentToGbegamey: 0,
  soldZogbo: 0,
  countedZogbo: null,
};
for (const [name, zero, movementKey] of [
  ["boissons_jours", BOISSONS_ZOGBO_ZERO, "site"],
  ["combos_jours", COMBOS_ZOGBO_ZERO, null],
]) {
  const col = db.collection(name);
  const docs = await col.find({}).toArray();
  if (dryRun) {
    console.log(`   ${name.padEnd(20)} ${docs.length} doc(s) : colonnes Zogbo remises à zéro`);
    continue;
  }
  if (docs.length) {
    await writeFile(
      path.join(exportDir, `${name}.json`),
      JSON.stringify(docs, null, 2),
      "utf8",
    );
  }
  for (const doc of docs) {
    const set = {
      lines: (doc.lines ?? []).map((l) => ({ ...l, ...zero })),
    };
    if (movementKey && Array.isArray(doc.movements)) {
      set.movements = doc.movements.filter((m) => m[movementKey] !== "zogbo");
    }
    await col.updateOne({ _id: doc._id }, { $set: set });
  }
  console.log(`🧹 ${name.padEnd(20)} ${docs.length} doc(s) : colonnes Zogbo remises à zéro`);
}

console.log(`\n${dryRun ? "Simulation" : "Terminé"} : ${total} document(s).`);
if (exportDir && !dryRun) console.log(`Export : ${exportDir}`);

await client.close();
