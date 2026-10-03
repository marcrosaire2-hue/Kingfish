/**
 * Initialise le suivi par période : chaque caisse ouverte démarre sa période
 * courante ; les sessions déjà fermées sans période restent regroupées dans
 * « l'historique » (aucun montant n'est modifié).
 *
 *   node --env-file=.env.local scripts/init-periodes-caisse.mjs          (simulation)
 *   node --env-file=.env.local scripts/init-periodes-caisse.mjs --apply
 */
import { MongoClient, ObjectId } from "mongodb";

const apply = process.argv.includes("--apply");
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");

const ouvertes = await db
  .collection("caisses_sessions")
  .find({
    statut: { $in: ["ouverte", "en_comptage"] },
    $or: [{ periodeId: { $exists: false } }, { periodeId: null }],
  })
  .toArray();

for (const s of ouvertes) {
  const caisse = s.caisse ?? s.site;
  const periodeId = `p-${caisse}-${new ObjectId().toHexString()}`;
  console.log(`${caisse} ${s.date} (${s.statut}) → ${periodeId}`);
  if (apply) {
    await db
      .collection("caisses_sessions")
      .updateOne({ _id: s._id }, { $set: { periodeId } });
  }
}
console.log(
  apply
    ? `${ouvertes.length} caisse(s) ouverte(s) initialisée(s).`
    : `Simulation : ${ouvertes.length} caisse(s) à initialiser (--apply pour écrire).`,
);
await client.close();
