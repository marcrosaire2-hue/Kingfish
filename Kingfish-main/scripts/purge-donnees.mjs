/**
 * Purge complète des données d’exploitation : ventes, tickets, historique,
 * caisses, stocks, imports AquaPro.
 *
 * Conservé : `parametres` (catalogue, prix), `users` (comptes), `pos_config`.
 * Sans ces trois collections l’application ne démarre plus et la connexion
 * devient impossible.
 *
 * Un export JSON est écrit avant suppression (option --export-dir).
 *
 * Usage:
 *   node --env-file=.env.local scripts/purge-donnees.mjs --dry-run
 *   node --env-file=.env.local scripts/purge-donnees.mjs --yes --export-dir=/chemin
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";

/** Collections de configuration — jamais purgées. */
const KEEP = new Set(["parametres", "users", "pos_config"]);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => !a.startsWith("--export-dir=")));
const dryRun = flags.has("--dry-run");
const confirmed = flags.has("--yes");
const exportDir = args
  .find((a) => a.startsWith("--export-dir="))
  ?.slice("--export-dir=".length);

if (!dryRun && !confirmed) {
  console.error("Refus : passez --yes pour purger, ou --dry-run pour simuler.");
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

const names = (await db.listCollections().toArray())
  .map((c) => c.name)
  .sort();

if (exportDir && !dryRun) await mkdir(exportDir, { recursive: true });

let total = 0;
for (const name of names) {
  const col = db.collection(name);
  const count = await col.countDocuments({});

  if (KEEP.has(name)) {
    console.log(`⏭  ${name.padEnd(30)} ${count} doc(s) — conservé`);
    continue;
  }
  if (dryRun) {
    console.log(`   ${name.padEnd(30)} ${count} doc(s) à supprimer`);
    total += count;
    continue;
  }

  if (exportDir && count > 0) {
    const docs = await col.find({}).toArray();
    await writeFile(
      path.join(exportDir, `${name}.json`),
      JSON.stringify(docs, null, 2),
      "utf8",
    );
  }

  const res = await col.deleteMany({});
  total += res.deletedCount;
  console.log(`🗑  ${name.padEnd(30)} ${res.deletedCount}/${count} supprimé(s)`);
}

console.log(`\n${dryRun ? "Simulation" : "Purge terminée"} : ${total} document(s).`);
if (exportDir && !dryRun) console.log(`Export : ${exportDir}`);

await client.close();
