#!/usr/bin/env node
/**
 * Détermine le stock de Gbégamey à partir de l'inventaire physique du 07/08.
 *
 * Base de départ : la journée `gbegamey_jours/2026-08-07` (source
 * `inventaire-marco`, colonne `counted` = compté dans le point de vente au
 * soir du 07/08). Les journées suivantes ont été ouvertes sans report : le
 * stock des plats y est à zéro alors que 220 portions restaient en rayon.
 *
 * Stock déterminé = compté au 07/08
 *                 + reçus de Zogbo depuis le 08/08
 *                 − vendus à Gbégamey depuis le 08/08
 *                 − pertes déclarées depuis le 08/08
 *
 * Les plats locaux sont préparés à la journée : seul ce qui a été compté au
 * 07/08 est repris (ATASSI), le reste part de zéro.
 *
 * Usage:
 *   node --env-file=.env.local scripts/stock-gbegamey-depuis-inventaire-0708.mjs
 *   DATE=2026-08-13 APPLY=1 node --env-file=.env.local scripts/stock-gbegamey-depuis-inventaire-0708.mjs
 */
import { MongoClient } from "mongodb";

const INVENTAIRE = "2026-08-07";
const DEPUIS = "2026-08-08";
const DATE = process.env.DATE || new Date().toLocaleDateString("en-CA", {
  timeZone: "Africa/Porto-Novo",
});
const APPLY = process.env.APPLY === "1";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
if (!uri || !dbName) {
  console.error("MONGODB_URI et MONGODB_DB requis (.env.local).");
  process.exit(1);
}

/** Mots vides qui distinguent « sauce monyo AU poisson fumé » de sa jumelle. */
const VIDES = new Set(["au", "aux", "a", "de", "du", "des", "la", "le", "les", "d", "l", "et"]);

function cle(nom) {
  return String(nom || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((m) => m && !VIDES.has(m))
    .join(" ");
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const inventaire = await db
  .collection("gbegamey_jours")
  .findOne({ _id: INVENTAIRE });
if (!inventaire) {
  console.error(`Journée ${INVENTAIRE} introuvable — inventaire non importé ?`);
  await client.close();
  process.exit(1);
}

// ——— Mouvements depuis l'inventaire ———————————————————————————————
const ventes = await db
  .collection("ventes_log")
  .aggregate([
    {
      $match: {
        site: "gbegamey",
        date: { $gte: DEPUIS, $lte: DATE },
        cancelledAt: null,
        kind: { $in: ["plat", "local"] },
      },
    },
    {
      $group: {
        _id: { productId: "$productId", name: "$name" },
        qty: { $sum: "$qty" },
      },
    },
  ])
  .toArray();

/** Vendus indexés par id ET par nom normalisé : l'import AquaPro a produit
 *  des identifiants voisins (« monyo poisson fume » sans le « au »). */
const vendusParId = new Map();
const vendusParNom = new Map();
for (const v of ventes) {
  const qty = Number(v.qty) || 0;
  vendusParId.set(v._id.productId, (vendusParId.get(v._id.productId) || 0) + qty);
  const k = cle(v._id.name);
  if (k) vendusParNom.set(k, (vendusParNom.get(k) || 0) + qty);
}

const joursDepuis = await db
  .collection("gbegamey_jours")
  .find({ _id: { $gt: INVENTAIRE, $lte: DATE } })
  .toArray();

const recusParId = new Map();
const pertesParId = new Map();
for (const j of joursDepuis) {
  for (const l of [...(j.transferLines || []), ...(j.localLines || [])]) {
    const recu = Number(l.received) || 0;
    const perte = Number(l.pertes) || 0;
    if (recu) recusParId.set(l.productId, (recusParId.get(l.productId) || 0) + recu);
    if (perte) pertesParId.set(l.productId, (pertesParId.get(l.productId) || 0) + perte);
  }
}

/** Consomme le vendu par id, sinon par nom (identifiants divergents). */
const nomsConsommes = new Set();
function venduPour(ligne) {
  const parId = vendusParId.get(ligne.productId);
  if (parId !== undefined) return { qty: parId, via: "id" };
  const k = cle(ligne.name);
  const parNom = vendusParNom.get(k);
  if (parNom !== undefined && !nomsConsommes.has(k)) {
    nomsConsommes.add(k);
    return { qty: parNom, via: "nom" };
  }
  return { qty: 0, via: null };
}

function determiner(lignes, { reporterNull }) {
  return lignes.map((l) => {
    const compte = l.counted === null || l.counted === undefined ? null : Number(l.counted);
    const base = compte === null ? (reporterNull ? 0 : null) : compte;
    const vendu = venduPour(l);
    const recu = recusParId.get(l.productId) || 0;
    const perte = pertesParId.get(l.productId) || 0;
    const stock = base === null ? null : Math.max(0, base + recu - vendu.qty - perte);
    return {
      productId: l.productId,
      name: l.name,
      compte,
      recu,
      vendu: vendu.qty,
      via: vendu.via,
      perte,
      stock,
    };
  });
}

const transferts = determiner(inventaire.transferLines || [], { reporterNull: false });
const locaux = determiner(inventaire.localLines || [], { reporterNull: false });

// ——— Rapport ——————————————————————————————————————————————————————
function tableau(titre, lignes) {
  console.log(`\n${titre}`);
  console.log(
    "  " +
      "Plat".padEnd(38) +
      "07/08".padStart(6) +
      "reçu".padStart(6) +
      "vendu".padStart(7) +
      "perte".padStart(7) +
      "stock".padStart(7),
  );
  let total = 0;
  for (const l of lignes) {
    if (l.compte === null && !l.vendu) continue;
    total += l.stock || 0;
    console.log(
      "  " +
        String(l.name).slice(0, 37).padEnd(38) +
        String(l.compte ?? "—").padStart(6) +
        String(l.recu || "").padStart(6) +
        String(l.vendu || "").padStart(7) +
        String(l.perte || "").padStart(7) +
        String(l.stock ?? "—").padStart(7) +
        (l.via === "nom" ? "   ← rapproché par nom" : ""),
    );
  }
  console.log("  " + "TOTAL".padEnd(38) + String(total).padStart(33));
  return total;
}

console.log(`Inventaire du ${INVENTAIRE} → stock au ${DATE}`);
console.log(`Ventes prises en compte : ${DEPUIS} → ${DATE}`);
const totalT = tableau("PLATS REÇUS DE ZOGBO", transferts);
const totalL = tableau("PLATS LOCAUX", locaux);
console.log(`\nStock Gbégamey déterminé : ${totalT + totalL} portions`);

if (!APPLY) {
  console.log("\nAucune écriture (APPLY=1 pour appliquer sur la journée).");
  await client.close();
  process.exit(0);
}

// ——— Application sur la journée courante ——————————————————————————
const jour = await db.collection("gbegamey_jours").findOne({ _id: DATE });
if (jour && jour.status === "cloturee") {
  console.error(`Journée ${DATE} clôturée : rien n'est écrit.`);
  await client.close();
  process.exit(1);
}

const obs = `Stock déterminé depuis l'inventaire du ${INVENTAIRE}`;
const now = new Date().toISOString();

function appliquer(existantes, determinees) {
  const parId = new Map(determinees.map((d) => [d.productId, d]));
  const lignes = (existantes || []).map((l) => {
    const d = parId.get(l.productId);
    if (!d || d.stock === null) return l;
    parId.delete(l.productId);
    return { ...l, initialStock: d.stock, observations: obs };
  });
  // Lignes de l'inventaire absentes de la journée courante.
  for (const d of parId.values()) {
    if (d.stock === null) continue;
    lignes.push({
      productId: d.productId,
      name: d.name,
      initialStock: d.stock,
      received: 0,
      sent: 0,
      prepared: 0,
      sold: 0,
      pertes: 0,
      counted: null,
      observations: obs,
    });
  }
  return lignes;
}

const transferLines = appliquer(jour?.transferLines, transferts);
const localLines = appliquer(jour?.localLines, locaux);

await db.collection("gbegamey_jours").updateOne(
  { _id: DATE },
  {
    $set: {
      _id: DATE,
      status: jour?.status || "ouverte",
      source: "inventaire-0708",
      transferLines,
      localLines,
      movements: jour?.movements || [],
      updatedAt: now,
    },
    $inc: { rev: 1 },
  },
  { upsert: true },
);

console.log(
  `\nÉcrit sur ${DATE} : ${transferLines.length} lignes de transfert, ${localLines.length} lignes locales.`,
);
await client.close();
