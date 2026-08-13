#!/usr/bin/env node
/**
 * Migration : sessions de caisse par utilisateur → caisses nommées.
 *
 * Chaque session existante porte un site ; elle devient une session de la
 * caisse de cette zone (`caisse: "zogbo" | "gbegamey"`). Les compteurs de
 * versement, absents avant, sont initialisés à 0.
 *
 * Le lecteur du repo sait déjà interpréter une session sans champ `caisse` :
 * cette migration n'est donc pas bloquante, elle met la base au propre.
 *
 * Usage:
 *   node --env-file=.env.local scripts/migrate-caisses.mjs          # rapport seul
 *   APPLY=1 node --env-file=.env.local scripts/migrate-caisses.mjs  # écrit
 */
import { MongoClient } from "mongodb";

const APPLY = process.env.APPLY === "1";
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

if (!uri || !dbName) {
  console.error("MONGODB_URI et MONGODB_DB requis (.env.local).");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
const col = db.collection("caisses_sessions");

const sansCaisse = await col.countDocuments({ caisse: { $exists: false } });
const sansVersements = await col.countDocuments({
  totalVersementSorti: { $exists: false },
});

// Invariant du nouveau modèle : une seule session ouverte par caisse. Deux
// vendeurs ayant ouvert la même zone le même jour se retrouveraient à deux
// sessions ouvertes — il faut trancher à la main plutôt que d'en fermer une
// au hasard.
const ouvertes = await col
  .aggregate([
    { $match: { statut: "ouverte" } },
    {
      $group: {
        _id: { $ifNull: ["$caisse", "$site"] },
        n: { $sum: 1 },
        sessions: {
          $push: { id: "$_id", user: "$userName", ouverte: "$openedAt" },
        },
      },
    },
  ])
  .toArray();

const conflits = ouvertes.filter((g) => g.n > 1);

console.log("État", {
  sessions: await col.countDocuments({}),
  sansChampCaisse: sansCaisse,
  sansCompteursVersement: sansVersements,
  caissesOuvertes: ouvertes.map((g) => ({ caisse: g._id, sessions: g.n })),
});

if (conflits.length) {
  console.error(
    "\nConflit : plusieurs sessions ouvertes sur une même caisse.\n" +
      "Fermez les sessions en trop dans l'application avant de migrer.\n",
  );
  for (const c of conflits) {
    console.error(` ${c._id} :`);
    for (const s of c.sessions) {
      console.error(`   - ${s.id} · ${s.user} · ouverte ${s.ouverte}`);
    }
  }
  await client.close();
  process.exit(1);
}

if (!APPLY) {
  console.log("\nAucune écriture (APPLY=1 pour appliquer).");
  await client.close();
  process.exit(0);
}

const nommage = await col.updateMany({ caisse: { $exists: false } }, [
  { $set: { caisse: "$site" } },
]);
const compteurs = await col.updateMany(
  { totalVersementSorti: { $exists: false } },
  { $set: { totalVersementSorti: 0, totalVersementRecu: 0 } },
);
const cloture = await col.updateMany(
  { closedById: { $exists: false } },
  { $set: { closedById: null, closedByName: null } },
);

console.log("Migré", {
  caisseRenseignee: nommage.modifiedCount,
  compteursVersement: compteurs.modifiedCount,
  champsCloture: cloture.modifiedCount,
});

await client.close();
