#!/usr/bin/env node
/**
 * Index des collections chaudes.
 *
 * `ventes_log` n'avait que son `_id` : chaque écran qui lit le journal des
 * ventes parcourait la collection entière. Sur une base distante — chaque
 * aller-retour coûte ~120 ms d'ici — ces balayages s'ajoutent au temps
 * d'ouverture de chaque page.
 *
 * Les index ci-dessous reprennent les filtres réellement écrits dans les
 * repos, dans l'ordre où ils sont utilisés (égalités d'abord, tri ensuite).
 *
 * Usage:
 *   node --env-file=.env.local scripts/creer-index.mjs           # rapport seul
 *   APPLY=1 node --env-file=.env.local scripts/creer-index.mjs   # crée
 */
import { MongoClient } from "mongodb";

const APPLY = process.env.APPLY === "1";
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
if (!uri || !dbName) {
  console.error("MONGODB_URI et MONGODB_DB requis (.env.local).");
  process.exit(1);
}

/** @type {{collection: string, index: Record<string, 1|-1>, nom: string, pourquoi: string}[]} */
const INDEX = [
  {
    collection: "ventes_log",
    index: { date: 1, site: 1, cancelledAt: 1, at: -1 },
    nom: "jour_site_actives",
    pourquoi: "journal du jour, CA par point, dernières ventes",
  },
  {
    collection: "ventes_log",
    index: { site: 1, cancelledAt: 1, date: -1, at: -1 },
    nom: "site_dernieres",
    pourquoi: "dernière journée vendue d'un point",
  },
  {
    collection: "ventes_log",
    index: { date: 1, kind: 1, cancelledAt: 1 },
    nom: "jour_type",
    pourquoi: "registres combos / boissons",
  },
  {
    collection: "ventes_log",
    index: { source: 1 },
    nom: "source",
    pourquoi: "réimports AquaPro (suppression puis réinsertion)",
  },
  {
    collection: "pos_tickets",
    index: { date: 1, site: 1, at: -1 },
    nom: "jour_site",
    pourquoi: "tickets du jour d'un point",
  },
  {
    collection: "pos_tickets",
    index: { clientRef: 1, site: 1 },
    nom: "reference_poste",
    pourquoi: "déduplication des ventes rejouées après coupure",
  },
  {
    collection: "caisses_sessions",
    index: { caisse: 1, statut: 1 },
    nom: "caisse_statut",
    pourquoi: "caisse ouverte d'une zone (à chaque vente)",
  },
  {
    collection: "caisses_sessions",
    index: { date: 1, site: 1 },
    nom: "jour_site",
    pourquoi: "dépenses et recettes du compte de résultat",
  },
  {
    collection: "caisse_mouvements",
    index: { caisseId: 1, at: -1 },
    nom: "caisse_journal",
    pourquoi: "journal d'une session de caisse",
  },
  {
    collection: "caisse_mouvements",
    index: { transfertId: 1 },
    nom: "transfert",
    pourquoi: "versements entre caisses (deux jambes liées)",
  },
];

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const existants = new Map();
for (const nom of new Set(INDEX.map((i) => i.collection))) {
  try {
    const liste = await db.collection(nom).indexes();
    existants.set(nom, new Set(liste.map((i) => i.name)));
  } catch {
    existants.set(nom, new Set());
  }
}

let aCreer = 0;
for (const item of INDEX) {
  const deja = existants.get(item.collection)?.has(item.nom);
  if (!deja) aCreer += 1;
  console.log(
    `${deja ? "présent " : "à créer "} ${item.collection}.${item.nom.padEnd(18)} ${JSON.stringify(item.index)}`,
  );
  if (!deja) console.log(`           → ${item.pourquoi}`);
}

if (!aCreer) {
  console.log("\nTous les index sont en place.");
  await client.close();
  process.exit(0);
}

if (!APPLY) {
  console.log(`\n${aCreer} index à créer — APPLY=1 pour les créer.`);
  await client.close();
  process.exit(0);
}

for (const item of INDEX) {
  if (existants.get(item.collection)?.has(item.nom)) continue;
  const debut = Date.now();
  // `background` est le défaut depuis MongoDB 4.2 : la base reste lisible et
  // inscriptible pendant la construction.
  await db.collection(item.collection).createIndex(item.index, {
    name: item.nom,
  });
  console.log(`créé ${item.collection}.${item.nom} (${Date.now() - debut} ms)`);
}

await client.close();
