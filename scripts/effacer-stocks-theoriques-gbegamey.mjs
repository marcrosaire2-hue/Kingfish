#!/usr/bin/env node
/**
 * Efface tous les stocks théoriques de Gbégamey (jour donné).
 *
 * - gbegamey_jours  : transferLines (initialStock, received) et localLines
 *   (initialStock, prepared) remis à 0 → théorique = 0, seul le comptage
 *   saisi (counted) fait foi.
 * - boissons_jours  : initialStock et purchases remis à 0 sur toutes les
 *   lignes (document partagé avec Zogbo) → théorique = 0.
 *
 * Les ventes, pertes et comptages (counted) sont conservés.
 *
 * Usage:
 *   node --env-file=.env.local scripts/effacer-stocks-theoriques-gbegamey.mjs [YYYY-MM-DD]
 *   APPLY=1 node --env-file=.env.local scripts/effacer-stocks-theoriques-gbegamey.mjs [YYYY-MM-DD]
 */
import { MongoClient } from "mongodb";

const APPLY = process.env.APPLY === "1";
const DATE = process.argv[2] ?? "2026-08-13";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
if (!uri || !dbName) {
  console.error("MONGODB_URI et MONGODB_DB requis (.env.local).");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const gbegameyCol = db.collection("gbegamey_jours");
const boissonsCol = db.collection("boissons_jours");

const gDoc = await gbegameyCol.findOne({ _id: DATE });
const bDoc = await boissonsCol.findOne({ _id: DATE });

if (!gDoc && !bDoc) {
  console.error(`Aucun document pour ${DATE}.`);
  process.exit(1);
}

console.log(`== ${DATE}${APPLY ? "" : "  (simulation, APPLY=1 pour appliquer)"}`);

if (gDoc) {
  const t0 = (gDoc.transferLines ?? []).length;
  const l0 = (gDoc.localLines ?? []).length;
  const transferChanged = (gDoc.transferLines ?? []).filter(
    (l) => l.initialStock !== 0 || l.received !== 0,
  ).length;
  const localChanged = (gDoc.localLines ?? []).filter(
    (l) => l.initialStock !== 0 || l.prepared !== 0,
  ).length;
  console.log(`Gbégamey : ${t0} transferLines (${transferChanged} à effacer), ${l0} localLines (${localChanged} à effacer)`);

  if (APPLY) {
    const transferLines = (gDoc.transferLines ?? []).map((l) => ({
      ...l,
      initialStock: 0,
      received: 0,
    }));
    const localLines = (gDoc.localLines ?? []).map((l) => ({
      ...l,
      initialStock: 0,
      prepared: 0,
    }));
    await gbegameyCol.updateOne(
      { _id: DATE },
      { $set: { transferLines, localLines, updatedAt: new Date().toISOString() } },
    );
    console.log("  gbegamey_jours effacé ✓");
  }
} else {
  console.log("Gbégamey : aucun document");
}

if (bDoc) {
  const n = (bDoc.lines ?? []).filter(
    (l) => l.initialStock !== 0 || l.purchases !== 0,
  ).length;
  console.log(`Boissons : ${(bDoc.lines ?? []).length} lignes (${n} à effacer, doc partagé Zogbo/Gbégamey)`);

  if (APPLY) {
    const lines = (bDoc.lines ?? []).map((l) => ({
      ...l,
      initialStock: 0,
      purchases: 0,
    }));
    await boissonsCol.updateOne(
      { _id: DATE },
      { $set: { lines, updatedAt: new Date().toISOString() } },
    );
    console.log("  boissons_jours effacé ✓");
  }
} else {
  console.log("Boissons : aucun document");
}

await client.close();
