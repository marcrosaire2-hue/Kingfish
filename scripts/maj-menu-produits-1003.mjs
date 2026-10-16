#!/usr/bin/env node
/**
 * Met à jour le menu des produits (catalogue `parametres`) d'après la liste
 * de prix transmise le 03/10/2026 (Tata Flo).
 *
 * - baseDishes  : plats poisson (chawarma, poissons, brochettes, tilapia…)
 * - localDishes : accompagnements (riz, spaghettis, attiéké, frites…)
 *
 * Un produit déjà présent (même id, nom ou alias) voit son PRIX mis à jour ;
 * sinon il est ajouté. Rien n'est supprimé, aucun autre champ n'est modifié.
 *
 * Usage:
 *   node --env-file=.env.local scripts/maj-menu-produits-1003.mjs          (aperçu)
 *   APPLY=1 node --env-file=.env.local scripts/maj-menu-produits-1003.mjs  (écrit)
 */
import { MongoClient } from "mongodb";

const APPLY = process.env.APPLY === "1";

/** [champ, id, nom, prix, alias de noms déjà existants] */
const MENU = [
  ["baseDishes", "base-chawarma-au-poisson", "CHAWARMA AU POISSON", 2000, []],
  ["baseDishes", "base-poisson-pane", "POISSON PANE", 1500, []],
  ["baseDishes", "base-filet-de-poisson-poele", "FILET DE POISSON POÊLÉ", 1500, []],
  ["baseDishes", "base-brochette-de-poisson", "BROCHETTE DE POISSON", 1500, ["brochettes de poisson"]],
  ["baseDishes", "base-tilapia-braise", "TILAPIA BRAISÉ", 2000, []],
  ["baseDishes", "base-machoiron-braise", "MACHOIRON BRAISÉ", 2000, []],
  ["baseDishes", "base-moyo-tilapia-frit", "MOYO TILAPIA FRIT", 1500, []],
  ["baseDishes", "base-moyo-machoiron-fume", "MOYO MACHOIRON FUMÉ", 1500, []],
  ["localDishes", "local-omelette", "OMELETTE", 500, []],
  ["localDishes", "local-riz", "RIZ", 500, []],
  ["localDishes", "local-legume-saute", "LEGUME SAUTÉ", 500, ["legumes sautes", "legume saute"]],
  ["localDishes", "local-spaghetti", "SPAGHETTI", 500, ["spaghettis"]],
  ["localDishes", "local-akassa", "AKASSA", 500, []],
  ["localDishes", "local-attieke", "ATTIÉKÉ", 500, ["attieke"]],
  ["localDishes", "local-alloco", "ALLOCO", 500, []],
  ["localDishes", "local-banane-bouillie", "BANANE BOUILLIE", 500, []],
  ["localDishes", "local-frites", "FRITES", 1000, []],
];

const norm = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "gestion_restaurant";
if (!uri) {
  console.error("MONGODB_URI requis (.env.local).");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const col = client.db(dbName).collection("parametres");
const doc = await col.findOne({ _id: "parametres" });
if (!doc) {
  console.error("Document parametres introuvable.");
  await client.close();
  process.exit(1);
}

const next = {
  baseDishes: [...(doc.baseDishes || [])],
  localDishes: [...(doc.localDishes || [])],
};

for (const [champ, id, nom, prix, alias] of MENU) {
  const noms = [nom, ...alias].map(norm);
  const liste = next[champ];
  const i = liste.findIndex((d) => d.id === id || noms.includes(norm(d.name)));
  if (i >= 0) {
    const ancien = liste[i].unitPrice;
    if (ancien === prix) {
      console.log(`= ${champ}  ${liste[i].name} : ${prix} F (inchangé)`);
    } else {
      console.log(`~ ${champ}  ${liste[i].name} : ${ancien} F -> ${prix} F`);
      liste[i] = { ...liste[i], unitPrice: prix };
    }
  } else {
    console.log(`+ ${champ}  ${nom} : ${prix} F (nouveau)`);
    liste.push({ id, name: nom, unitPrice: prix });
  }
}

if (!APPLY) {
  console.log("\nAucune écriture (APPLY=1 pour appliquer).");
} else {
  await col.updateOne(
    { _id: "parametres" },
    {
      $set: {
        baseDishes: next.baseDishes,
        localDishes: next.localDishes,
        updatedAt: new Date().toISOString(),
      },
    },
  );
  console.log("\nCatalogue mis à jour.");
}
await client.close();
