/**
 * Sauvegarde complète de la base vers un dossier horodaté.
 *
 * Chaque collection donne un fichier JSON, plus un manifeste listant les
 * volumes — de quoi vérifier d'un coup d'œil qu'une sauvegarde n'est pas vide.
 * Les anciennes sauvegardes au-delà de RETENTION sont supprimées.
 *
 * Usage :
 *   node --env-file=.env.local scripts/sauvegarde.mjs
 *   BACKUP_DIR=/chemin RETENTION=30 node --env-file=.env.local scripts/sauvegarde.mjs
 *
 * Restauration : voir scripts/restaurer.mjs
 */
import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI manquant (utilisez --env-file=.env.local).");
  process.exit(1);
}

const root = process.env.BACKUP_DIR || "sauvegardes";
const retention = Math.max(1, Number(process.env.RETENTION) || 14);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(root, stamp);

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");

await mkdir(target, { recursive: true });

const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
const manifeste = { date: new Date().toISOString(), base: db.databaseName, collections: {} };
let total = 0;

for (const name of names) {
  const docs = await db.collection(name).find({}).toArray();
  await writeFile(
    path.join(target, `${name}.json`),
    JSON.stringify(docs, null, 2),
    "utf8",
  );
  manifeste.collections[name] = docs.length;
  total += docs.length;
  console.log(`${String(docs.length).padStart(6)}  ${name}`);
}

manifeste.total = total;
await writeFile(
  path.join(target, "_manifeste.json"),
  JSON.stringify(manifeste, null, 2),
  "utf8",
);

console.log(`\nSauvegarde : ${target} — ${total} document(s)`);

// Une sauvegarde vide signale presque toujours un incident : on le dit fort.
if (total === 0) {
  console.error("ATTENTION : la base est vide, la sauvegarde ne contient rien.");
}

// Rotation
const entries = (await readdir(root, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
const surplus = entries.slice(0, Math.max(0, entries.length - retention));
for (const old of surplus) {
  await rm(path.join(root, old), { recursive: true, force: true });
  console.log(`Ancienne sauvegarde supprimée : ${old}`);
}

await client.close();
