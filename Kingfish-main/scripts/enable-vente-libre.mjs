/**
 * Active le mode vente libre (dégrise les articles) pour la date du jour
 * sans supprimer les stocks / journées.
 *
 *   node --env-file=.env.local scripts/enable-vente-libre.mjs
 *   DATE=2026-09-02 node --env-file=.env.local scripts/enable-vente-libre.mjs
 */
import { MongoClient } from "mongodb";

const date =
  process.env.DATE ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Porto-Novo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`DATE invalide : ${date}`);
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
const updatedAt = new Date().toISOString();

for (const name of ["zogbo_jours", "gbegamey_jours"]) {
  const col = db.collection(name);
  const before = await col.findOne({ _id: date });
  console.log(
    `${name} avant:`,
    before
      ? { ventesSansStock: before.ventesSansStock === true, status: before.status }
      : "(absent)",
  );
  const res = await col.updateOne(
    { _id: date },
    {
      $set: {
        ventesSansStock: true,
        updatedAt,
        source: "enable-vente-libre",
      },
      $setOnInsert: { status: "ouverte" },
    },
    { upsert: true },
  );
  const after = await col.findOne({ _id: date });
  console.log(`${name} après:`, {
    matched: res.matchedCount,
    upserted: res.upsertedCount,
    modified: res.modifiedCount,
    ventesSansStock: after?.ventesSansStock === true,
  });
}

await client.close();
console.log(`Vente libre activée pour ${date} (Zogbo + Gbégamey).`);
