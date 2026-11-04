/**
 * Remise à zéro du stock Gbégamey (plats, accompagnements, boissons) à partir
 * d'une date de départ, pour repartir uniquement des stocks saisis dans
 * l'appli. Zogbo n'est PAS touché. Le journal des ventes (ventes_log) et le
 * CA ne sont PAS touchés.
 *
 * - gbegamey_jours, à partir de DEPART (inclus) : tout à 0 (stock, reçu,
 *   préparé, vendu, pertes), comptage vide, suivi retiré.
 * - gbegamey_jours, les 7 jours avant DEPART : stock seul remis à 0 (ventes
 *   conservées), sinon l'ancien stock serait reporté sur DEPART.
 * - boissons_jours, à partir de DEPART : champs Gbégamey à 0, comptage vide,
 *   suivi retiré, mouvements Gbégamey retirés. Les champs Zogbo restent.
 *
 * Une sauvegarde JSON de tous les documents modifiés est écrite d'abord dans
 * exports/sauvegarde-gbegamey-avant-remise-zero-<horodatage>/.
 *
 * Usage :
 *   node --env-file=.env.local scripts/remise-zero-stock-gbegamey.mjs --dry-run
 *   node --env-file=.env.local scripts/remise-zero-stock-gbegamey.mjs --yes
 *   DEPART=2026-11-02 node --env-file=.env.local scripts/remise-zero-stock-gbegamey.mjs --yes
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MongoClient } from "mongodb";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const confirmed = args.has("--yes");
if (!dryRun && !confirmed) {
  console.error("Refus : passez --yes pour appliquer, ou --dry-run pour simuler.");
  process.exit(1);
}

const depart = process.env.DEPART || "2026-11-02";
if (!/^\d{4}-\d{2}-\d{2}$/.test(depart)) {
  console.error(`DEPART invalide : ${depart} (attendu YYYY-MM-DD)`);
  process.exit(1);
}
const LOOKBACK_DAYS = 7;
const d = new Date(`${depart}T00:00:00Z`);
d.setUTCDate(d.getUTCDate() - LOOKBACK_DAYS);
const lookbackFrom = d.toISOString().slice(0, 10);

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI manquant (utilisez --env-file=.env.local).");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");
const now = new Date().toISOString();
const SOURCE = "remise-zero-stock-gbegamey";

function stripTracked(line) {
  const { stockTracked: _drop, ...rest } = line;
  void _drop;
  return rest;
}

function zeroTransfer(line, keepSales) {
  return {
    ...stripTracked(line),
    initialStock: 0,
    received: null,
    counted: null,
    ...(keepSales ? {} : { sold: 0, pertes: 0 }),
  };
}

function zeroLocal(line, keepSales) {
  return {
    ...stripTracked(line),
    initialStock: 0,
    prepared: 0,
    counted: null,
    ...(keepSales ? {} : { sold: 0, pertes: 0 }),
  };
}

function zeroDrinkGbegamey(line) {
  const { stockTrackedGbegamey: _drop, ...rest } = line;
  void _drop;
  return {
    ...rest,
    initialStockGbegamey: 0,
    purchasesGbegamey: 0,
    soldGbegamey: 0,
    pertesGbegamey: 0,
    countedGbegamey: null,
  };
}

const gbeDocs = await db
  .collection("gbegamey_jours")
  .find({ _id: { $gte: lookbackFrom } })
  .sort({ _id: 1 })
  .toArray();
const drinkDocs = await db
  .collection("boissons_jours")
  .find({ _id: { $gte: depart } })
  .sort({ _id: 1 })
  .toArray();

// Sauvegarde d'abord.
const stamp = now.replace(/[:.]/g, "-");
const backupDir = join(
  process.cwd(),
  "exports",
  `sauvegarde-gbegamey-avant-remise-zero-${stamp}`,
);
if (!dryRun) {
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(
    join(backupDir, "gbegamey_jours.json"),
    JSON.stringify(gbeDocs, null, 2),
  );
  writeFileSync(
    join(backupDir, "boissons_jours.json"),
    JSON.stringify(drinkDocs, null, 2),
  );
  console.log(`Sauvegarde écrite : ${backupDir}`);
}

for (const doc of gbeDocs) {
  const fromDepart = doc._id >= depart;
  const keepSales = !fromDepart;
  const transferLines = (doc.transferLines ?? []).map((l) =>
    zeroTransfer(l, keepSales),
  );
  const localLines = (doc.localLines ?? []).map((l) => zeroLocal(l, keepSales));
  const soldBefore = [...(doc.transferLines ?? []), ...(doc.localLines ?? [])]
    .reduce((s, l) => s + (Number(l.sold) || 0), 0);
  const label = fromDepart
    ? `tout à 0 (vendus ${soldBefore} → 0)`
    : "stock à 0, ventes conservées";
  if (dryRun) {
    console.log(`gbegamey_jours ${doc._id} : ${label} — simulation`);
    continue;
  }
  const update = {
    $set: { transferLines, localLines, updatedAt: now, source: SOURCE },
    $inc: { rev: 1 },
  };
  if (fromDepart) {
    update.$set.status = "ouverte";
    update.$unset = { ventesSansStock: "" };
  }
  await db.collection("gbegamey_jours").updateOne({ _id: doc._id }, update);
  console.log(`gbegamey_jours ${doc._id} : ${label}`);
}

for (const doc of drinkDocs) {
  const lines = (doc.lines ?? []).map(zeroDrinkGbegamey);
  const movements = (doc.movements ?? []).filter((m) => m.site !== "gbegamey");
  const removed = (doc.movements ?? []).length - movements.length;
  if (dryRun) {
    console.log(
      `boissons_jours ${doc._id} : champs Gbégamey à 0, ${removed} mouvement(s) Gbégamey retiré(s) — simulation`,
    );
    continue;
  }
  await db.collection("boissons_jours").updateOne(
    { _id: doc._id },
    { $set: { lines, movements, updatedAt: now }, $inc: { rev: 1 } },
  );
  console.log(
    `boissons_jours ${doc._id} : champs Gbégamey à 0, ${removed} mouvement(s) Gbégamey retiré(s)`,
  );
}

const ventes = await db
  .collection("ventes_log")
  .countDocuments({ site: "gbegamey", date: { $gte: depart } });
console.log(`ventes_log Gbégamey depuis ${depart} : ${ventes} ligne(s) conservée(s) (non touché)`);
console.log("Zogbo : non touché.");

await client.close();
