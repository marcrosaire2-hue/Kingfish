/**
 * Reprise des versements déjà confirmés dans la caisse.
 *
 * Chaque versement confirmé sans `caisseMouvementId` crée une entrée
 * « versement-entree » sur la session de caisse de son site et de son jour,
 * comme le fait désormais la confirmation. Idempotent : un versement déjà
 * repris est ignoré.
 *
 * Usage :
 *   node --env-file=.env.local scripts/reprise-versements-caisse.mjs          (simulation)
 *   node --env-file=.env.local scripts/reprise-versements-caisse.mjs --apply  (écriture)
 *   --backup=chemin.json  sauvegarde avant écriture
 */
import { MongoClient, ObjectId } from "mongodb";
import { writeFileSync } from "node:fs";

const apply = process.argv.includes("--apply");
const backupArg = process.argv.find((a) => a.startsWith("--backup="));
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");

const versements = await db
  .collection("versements")
  .find({
    statut: "confirmee",
    $or: [{ caisseMouvementId: { $exists: false } }, { caisseMouvementId: null }],
  })
  .sort({ date: 1, confirmedAt: 1 })
  .toArray();

const n = (v) => Math.round(Number(v) || 0);
const theorique = (s) =>
  n(s.soldeInitial) +
  n(s.totalRecette) +
  n(s.totalVersementRecu) -
  n(s.totalDepense) -
  n(s.totalVersementSorti);

const plan = [];
const ignores = [];
const sessionsCache = new Map();
for (const v of versements) {
  const key = `${v.site}|${v.date}`;
  if (!sessionsCache.has(key)) {
    const s = await db
      .collection("caisses_sessions")
      .find({ date: v.date, $or: [{ caisse: v.site }, { site: v.site }] })
      .sort({ openedAt: -1 })
      .limit(1)
      .toArray();
    sessionsCache.set(key, s[0] ?? null);
  }
  const session = sessionsCache.get(key);
  if (!session) {
    ignores.push({ id: String(v._id), date: v.date, site: v.site, montant: v.montant });
    continue;
  }
  plan.push({ v, session });
}

const totalPlan = plan.reduce((s, p) => s + n(p.v.montant), 0);
console.log(
  `${versements.length} versements confirmés à reprendre · ${plan.length} avec session (${totalPlan} FCFA) · ${ignores.length} sans session`,
);
if (ignores.length) console.log("Sans session :", JSON.stringify(ignores));

if (!apply) {
  console.log("Simulation seulement. Relancez avec --apply pour écrire.");
  await client.close();
  process.exit(0);
}

if (backupArg) {
  const ids = [...new Set(plan.map((p) => String(p.session._id)))].map(
    (id) => new ObjectId(id),
  );
  const sessions = await db
    .collection("caisses_sessions")
    .find({ _id: { $in: ids } })
    .toArray();
  writeFileSync(
    backupArg.slice("--backup=".length),
    JSON.stringify({ versements, sessions }, null, 1),
  );
  console.log("Sauvegarde écrite :", backupArg.slice("--backup=".length));
}

let faits = 0;
for (const { v, session } of plan) {
  const courant = await db
    .collection("caisses_sessions")
    .findOne({ _id: session._id });
  const soldeAvant = theorique(courant);
  const montant = n(v.montant);
  const mouvement = {
    _id: new ObjectId(),
    caisseId: String(session._id),
    kind: "versement-entree",
    nature: `Versement confirmé · n° ${v.numeroTransaction} (repris)`,
    beneficiaire: v.actorName || "—",
    montant,
    at: v.confirmedAt || v.createdAt || new Date().toISOString(),
    soldeAvant,
    soldeApres: soldeAvant + montant,
    actorId: v.confirmedById || v.actorId || null,
    actorName: v.confirmedByName || v.actorName || null,
    transfertId: null,
    contrepartie: null,
    cancelledAt: null,
    cancelledById: null,
    cancelledByName: null,
  };
  await db.collection("caisse_mouvements").insertOne(mouvement);
  await db.collection("caisses_sessions").updateOne(
    { _id: session._id },
    {
      $inc: { totalVersementRecu: montant },
      $set: { updatedAt: new Date().toISOString() },
    },
  );
  await db
    .collection("versements")
    .updateOne(
      { _id: v._id },
      { $set: { caisseMouvementId: String(mouvement._id) } },
    );
  faits += 1;
}
console.log(`${faits} versements repris dans la caisse.`);
await client.close();
