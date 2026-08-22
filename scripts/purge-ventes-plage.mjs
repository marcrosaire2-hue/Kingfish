/**
 * Suppression définitive des ventes sur une plage de dates.
 *
 * Usage:
 *   node --env-file=.env.local scripts/purge-ventes-plage.mjs --dry-run --from=2026-08-08 --to=2026-08-15
 *   node --env-file=.env.local scripts/purge-ventes-plage.mjs --yes --from=2026-08-08 --to=2026-08-15
 */
import { MongoClient, ObjectId } from "mongodb";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => !a.includes("=")));
const dryRun = flags.has("--dry-run");
const confirmed = flags.has("--yes");
const from =
  args.find((a) => a.startsWith("--from="))?.slice("--from=".length) ||
  "2026-08-08";
const to =
  args.find((a) => a.startsWith("--to="))?.slice("--to=".length) ||
  "2026-08-15";
const site =
  args.find((a) => a.startsWith("--site="))?.slice("--site=".length) || "all";

if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  console.error("Dates invalides (attendu YYYY-MM-DD).");
  process.exit(1);
}

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

const dateMatch = { date: { $gte: from, $lte: to } };
const siteQ = site !== "all" ? { site } : {};

const posCount = await db
  .collection("pos_tickets")
  .countDocuments({ ...dateMatch, ...siteQ });
const vlCount = await db
  .collection("ventes_log")
  .countDocuments({ ...dateMatch, ...siteQ });
const aquaCount =
  site === "all" || site === "gbegamey"
    ? await db.collection("aquapro_tickets").countDocuments(dateMatch)
    : 0;

console.log(`Plage ${from} → ${to} · site=${site}`);
console.log(`  pos_tickets   : ${posCount}`);
console.log(`  ventes_log    : ${vlCount}`);
console.log(`  aquapro_tickets: ${aquaCount}`);

if (dryRun) {
  await client.close();
  process.exit(0);
}

/** Reprend le stock vendu si la ligne journal est encore active. */
async function restoreStockIfActive(doc) {
  if (doc.cancelledAt || doc.caExcluded === true || doc.kind === "extra") {
    return;
  }
  const date = doc.date;
  const siteName = doc.site;
  const kind = doc.kind;
  const productId = doc.productId;
  const delta = -Number(doc.qty) || 0;
  if (!delta) return;

  if (kind === "plat" || kind === "local") {
    const col = siteName === "zogbo" ? "zogbo_jours" : "gbegamey_jours";
    const field = kind === "plat" ? "lines" : "accompanimentLines";
    const soldField = "sold";
    await db.collection(col).updateOne(
      { _id: date, [`${field}.productId`]: productId },
      { $inc: { [`${field}.$.${soldField}`]: delta } },
    );
  } else if (kind === "combo") {
    const soldField = siteName === "zogbo" ? "soldZogbo" : "soldGbegamey";
    await db.collection("combos_jours").updateOne(
      { _id: date, "lines.productId": productId },
      { $inc: { [`lines.$.${soldField}`]: delta } },
    );
  } else if (kind === "boisson") {
    const soldField = siteName === "zogbo" ? "soldZogbo" : "soldGbegamey";
    await db.collection("boissons_jours").updateOne(
      { _id: date, "lines.productId": productId },
      { $inc: { [`lines.$.${soldField}`]: delta } },
    );
  }
}

async function adjustCaisse(caisseId, delta) {
  if (!caisseId || !delta) return;
  await db
    .collection("caisses")
    .updateOne({ _id: caisseId }, { $inc: { ventesMontant: delta } });
}

const tickets = await db
  .collection("pos_tickets")
  .find({ ...dateMatch, ...siteQ })
  .toArray();

let deletedPos = 0;
for (const t of tickets) {
  if (t.statut === "valide" && t.caisseId) {
    await adjustCaisse(t.caisseId, -(Number(t.montant) || 0));
  }
  for (const line of t.lines ?? []) {
    if (!line.venteLogId || !ObjectId.isValid(line.venteLogId)) continue;
    const log = await db.collection("ventes_log").findOne({
      _id: new ObjectId(line.venteLogId),
    });
    if (log) {
      await restoreStockIfActive(log);
      await db.collection("ventes_log").deleteOne({ _id: log._id });
    }
  }
  await db.collection("pos_tickets").deleteOne({ _id: t._id });
  deletedPos += 1;
}

const orphans = await db
  .collection("ventes_log")
  .find({ ...dateMatch, ...siteQ })
  .toArray();

let deletedLog = 0;
for (const doc of orphans) {
  await restoreStockIfActive(doc);
  await db.collection("ventes_log").deleteOne({ _id: doc._id });
  deletedLog += 1;
}

let deletedAqua = 0;
if (site === "all" || site === "gbegamey") {
  const res = await db.collection("aquapro_tickets").deleteMany(dateMatch);
  deletedAqua = res.deletedCount;
}

console.log(`\nSupprimé : ${deletedPos} ticket(s) POS, ${deletedLog} ventes_log, ${deletedAqua} AquaPro.`);

await client.close();
