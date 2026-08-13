/**
 * Restaure la vente annulée MOKA PB (6a7deb5864b8e1254dcda0c4) du 13/08/2026 :
 * la remet active avec son heure d'origine (at conservé) et re-ajoute le
 * compteur vendu (boissons_jours.soldZogbo +1), symétrique de l'annulation.
 *
 * Usage:
 *   node --env-file=.env.local scripts/restaurer-vente-moka.mjs --dry-run
 *   node --env-file=.env.local scripts/restaurer-vente-moka.mjs --yes
 */
import { MongoClient, ObjectId } from "mongodb";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const confirmed = args.has("--yes");

if (!dryRun && !confirmed) {
  console.error("Refus : passez --yes pour appliquer, ou --dry-run pour simuler.");
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
if (!uri || !dbName) {
  console.error("MONGODB_URI et MONGODB_DB requis (.env.local).");
  process.exit(1);
}

const ID = "6a7deb5864b8e1254dcda0c4";
const DATE = "2026-08-13";

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const v = await db.collection("ventes_log").findOne({ _id: new ObjectId(ID) });
if (!v) {
  console.error("Vente introuvable.");
  process.exit(1);
}
if (!v.cancelledAt) {
  console.error("Cette vente n'est pas annulée, rien à faire.");
  process.exit(1);
}

console.log(
  `Vente : ${v.name} ×${v.qty} à ${v.at} (${v.amount} FCFA) — annulée ${v.cancelledAt} par ${v.cancelledByUsername}`,
);

if (dryRun) {
  console.log(`Simulation : réactivation + soldZogbo +${v.qty} sur boissons_jours ${DATE}.`);
  await client.close();
  process.exit(0);
}

const res = await db.collection("ventes_log").updateOne(
  { _id: new ObjectId(ID) },
  {
    $set: {
      cancelledAt: null,
      cancelledById: null,
      cancelledByName: null,
      cancelledByUsername: null,
    },
  },
);
console.log(`ventes_log : ${res.modifiedCount} document réactivé (heure d'origine ${v.at} conservée).`);

const stock = await db.collection("boissons_jours").findOneAndUpdate(
  {
    _id: DATE,
    lines: {
      $elemMatch: {
        productId: v.productId,
        soldZogbo: { $gte: -v.qty },
      },
    },
  },
  {
    $inc: { "lines.$[el].soldZogbo": v.qty, rev: 1 },
    $set: { updatedAt: new Date().toISOString() },
  },
  {
    arrayFilters: [{ "el.productId": v.productId }],
    returnDocument: "after",
    projection: { lines: 1 },
  },
);
if (!stock) {
  console.error("Échec : compteur boissons non restauré (ligne introuvable).");
  process.exit(1);
}
const line = stock.lines.find((l) => l.productId === v.productId);
console.log(`boissons_jours : soldZogbo ${v.name} = ${line.soldZogbo} (restauré).`);

await client.close();