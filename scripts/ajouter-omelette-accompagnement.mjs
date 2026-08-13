#!/usr/bin/env node
/**
 * Ajoute « Omelette » au catalogue des accompagnements (localDishes).
 *
 * Catalogue partagé Zogbo/Gbégamey : une fois ajouté, l'accompagnement
 * apparaît dans le composeur des deux points de vente. Prix retenu (500 F) :
 * celui déjà pratiqué pour les deux ventes d'Omelette passées en « extra »
 * le 12/08 (ventes_log, kind=extra, unitPrice=500).
 *
 * Usage:
 *   node --env-file=.env.local scripts/ajouter-omelette-accompagnement.mjs
 *   APPLY=1 node --env-file=.env.local scripts/ajouter-omelette-accompagnement.mjs
 */
import { MongoClient } from "mongodb";

const APPLY = process.env.APPLY === "1";
const ID = "local-omelette";
const NOM = "OMELETTE";
const PRIX = 500;

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
if (!uri || !dbName) {
  console.error("MONGODB_URI et MONGODB_DB requis (.env.local).");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const parametres = await db.collection("parametres").findOne({ _id: "parametres" });
if (!parametres) {
  console.error("Document parametres introuvable.");
  await client.close();
  process.exit(1);
}

const existant = (parametres.localDishes || []).find(
  (d) => d.id === ID || d.name.trim().toLowerCase() === NOM.toLowerCase(),
);
if (existant) {
  console.log("Déjà présent :", existant);
  await client.close();
  process.exit(0);
}

console.log("À ajouter :", { id: ID, name: NOM, unitPrice: PRIX });

if (!APPLY) {
  console.log("\nAucune écriture (APPLY=1 pour appliquer).");
  await client.close();
  process.exit(0);
}

await db.collection("parametres").updateOne(
  { _id: "parametres" },
  {
    $push: { localDishes: { id: ID, name: NOM, unitPrice: PRIX } },
    $set: { updatedAt: new Date().toISOString() },
  },
);

console.log("Ajouté.");
await client.close();
