/**
 * Bascule l'équipe des ventes et tickets POS de gestion2 (équipe nuit) :
 * « aucune » → « nuit » sur les 12 et 13/08/2026.
 *
 * Usage:
 *   node --env-file=.env.local scripts/basculer-gestion2-nuit.mjs --dry-run
 *   node --env-file=.env.local scripts/basculer-gestion2-nuit.mjs --yes
 */
import { MongoClient, ObjectId } from "mongodb";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const confirmed = args.has("--yes");

if (!dryRun && !confirmed) {
  console.error("Refus : passez --yes pour appliquer, ou --dry-run pour compter.");
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

const user = await db.collection("users").findOne({ username: "gestion2" });
if (!user) {
  console.error("Utilisateur gestion2 introuvable.");
  process.exit(1);
}
const g2Id = user._id.toHexString();
console.log(`gestion2 (${g2Id}, shift actuel : ${user.shift})`);

const FILTER = { actorUsername: "gestion2", shift: "aucune" };
const vRes = dryRun
  ? { matchedCount: await db.collection("ventes_log").countDocuments(FILTER) }
  : await db.collection("ventes_log").updateMany(FILTER, { $set: { shift: "nuit" } });
console.log(`ventes_log : ${vRes.matchedCount ?? vRes.modifiedCount} ligne(s) → nuit`);

const tFilter = { userId: g2Id, shift: "aucune" };
const tRes = dryRun
  ? { matchedCount: await db.collection("pos_tickets").countDocuments(tFilter) }
  : await db.collection("pos_tickets").updateMany(tFilter, { $set: { shift: "nuit" } });
console.log(`pos_tickets : ${tRes.matchedCount ?? tRes.modifiedCount} ticket(s) → nuit`);

if (dryRun) console.log("Simulation (--yes pour appliquer).");
await client.close();