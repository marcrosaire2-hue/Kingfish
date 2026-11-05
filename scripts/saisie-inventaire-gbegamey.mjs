/**
 * Enregistre l'inventaire de Gbégamey (comptage physique du 01/11 pour les
 * plats et accompagnements, du 02/11 pour les boissons) comme stock initial
 * au 02/11, puis reprend les ventes du journal du 02/11 jusqu'à JUSQUA pour
 * que la page Stock affiche le stock actuel :
 *
 *   02/11 : Entrées = comptage (devient le SI), Vendus = ventes du jour
 *   jours suivants : Ouverture = théorique de la veille, Vendus = ventes du jour
 *
 * Seuls les produits listés ci-dessous (déjà présents au catalogue) sont
 * touchés. Zogbo n'est pas touché. Le journal des ventes n'est pas modifié.
 * Une sauvegarde des journées Gbégamey et boissons est écrite d'abord.
 *
 * Usage :
 *   node --env-file=.env.local scripts/saisie-inventaire-gbegamey.mjs --dry-run
 *   node --env-file=.env.local scripts/saisie-inventaire-gbegamey.mjs --yes
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MongoClient } from "mongodb";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}
const DEPART = "2026-11-02";
const JUSQUA = process.env.JUSQUA || "2026-11-05";

// Comptages de l'inventaire (noms exacts du catalogue).
const BOISSONS_BT = {
  "SPRITE EN CANETTE 33 CL": 24,
  "FANTA EN CANETTE 33 CL": 23,
  "Beaufort GB": 28,
  "Beaufort PB": 47,
  "Béninoise GB": 16,
  "BENINOISE PB": 32,
  "Castel GB": 14,
  "Chill GB": 26,
  "COCA COLA PB": 54,
  "COCKTAIL PB": 35,
  "Doppel GB": 28,
  "FIFA GB": 59,
  "FIFA PB": 118,
  "Flag GB": 17,
  "GUINNESS PM": 29,
  "HAGBE GB": 25,
  "Kankpe GB": 18,
  "Kwabo GB": 9,
  "MOKA PB": 45,
  "PAMPLEMOUSSE PB": 41,
  "YOUZOU SPRITE PB": 30,
};
const PLATS = {
  "BROCHETTES DE POISSON ( 2 ou 3 brochettes de 150g au total)": 7,
  "CHAWARMA AU POISSON FUME": 52,
  "MACHOIRON FRIT MOYEN INFERIEUR A400G": 34,
  "POISSON PANE 150G": 35,
  "TILAPIA FRIT MOYEN 400G/500G": 22,
  "RILLETTES DE POISSON": 11,
  "SAUCE GRAINE": 1,
};
const ACCOMPAGNEMENTS = {
  "ALLOCO PORTION DE 200G EN ACCOMPAGNEMENT": 4.5,
  "ALLOCO PORTION DE 250G SEUL SANS PLAT": 4,
  "FRITES (PORTION DE 250G)": 8,
  AKASSA: 2,
  RIZ: 16,
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");
const parametres = await db.collection("parametres").findOne({});

function resoudre(table, liste, libelle) {
  const out = new Map();
  for (const [nom, qty] of Object.entries(table)) {
    const p = liste.find((x) => x.name === nom);
    if (!p) throw new Error(`${libelle} introuvable au catalogue : ${nom}`);
    out.set(p.id, { name: p.name, qty, upc: Math.max(1, Math.round(Number(p.unitsPerCasier) || 24)) });
  }
  return out;
}
const drinks = resoudre(BOISSONS_BT, parametres.drinks, "Boisson");
const plats = resoudre(PLATS, parametres.baseDishes, "Plat");
const accs = resoudre(ACCOMPAGNEMENTS, parametres.localDishes, "Accompagnement");

const dates = [];
for (let d = new Date(`${DEPART}T00:00:00Z`); d.toISOString().slice(0, 10) <= JUSQUA; d.setUTCDate(d.getUTCDate() + 1)) {
  dates.push(d.toISOString().slice(0, 10));
}

// Ventes actives du journal, par jour / type / produit.
const ventes = new Map();
for (const v of await db.collection("ventes_log").aggregate([
  { $match: { site: "gbegamey", date: { $gte: DEPART, $lte: JUSQUA }, cancelledAt: null, caExcluded: { $ne: true } } },
  { $group: { _id: { date: "$date", kind: "$kind", productId: "$productId" }, q: { $sum: "$qty" } } },
]).toArray()) {
  ventes.set(`${v._id.date}|${v._id.kind}|${v._id.productId}`, v.q);
}
const vendu = (date, kind, id) => Math.max(0, ventes.get(`${date}|${kind}|${id}`) || 0);

// Sauvegarde.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const gbeDocs = await db.collection("gbegamey_jours").find({ _id: { $in: dates } }).toArray();
const boiDocs = await db.collection("boissons_jours").find({ _id: { $in: dates } }).toArray();
if (!dryRun) {
  const dir = join(process.cwd(), "exports", `sauvegarde-avant-inventaire-gbegamey-${stamp}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "gbegamey_jours.json"), JSON.stringify(gbeDocs, null, 2));
  writeFileSync(join(dir, "boissons_jours.json"), JSON.stringify(boiDocs, null, 2));
  writeFileSync(join(dir, "stock_si.json"), JSON.stringify(await db.collection("stock_si").find({ site: "gbegamey" }).toArray(), null, 2));
  console.log(`Sauvegarde : ${dir}`);
}

// Calcul jour par jour : ouverture = théorique de la veille.
const report = new Map(); // `${kind}|${id}` -> unités (bouteilles pour les boissons)
const finaux = [];
for (const date of dates) {
  const premier = date === DEPART;
  const gbe = gbeDocs.find((d) => d._id === date) ?? { _id: date, status: "ouverte", transferLines: [], localLines: [] };
  const majLigne = (lignes, kind, table, champEntree) =>
    lignes.map((l) => {
      const p = table.get(l.productId);
      if (!p) return l;
      const ouverture = premier ? 0 : report.get(`${kind}|${l.productId}`) ?? 0;
      const entree = premier ? p.qty : 0;
      const sold = vendu(date, kind, l.productId);
      report.set(`${kind}|${l.productId}`, Math.max(0, ouverture + entree - sold));
      return { ...l, initialStock: ouverture, [champEntree]: entree, sold, pertes: 0, counted: null, stockTracked: true };
    });
  const transferLines = majLigne(gbe.transferLines ?? [], "plat", plats, "received");
  const localLines = majLigne(gbe.localLines ?? [], "local", accs, "prepared");
  const boi = boiDocs.find((d) => d._id === date);
  const lines = (boi?.lines ?? []).map((l) => {
    const p = drinks.get(l.productId);
    if (!p) return l;
    const ouverture = premier ? 0 : report.get(`boisson|${l.productId}`) ?? 0;
    const entree = premier ? p.qty : 0;
    const sold = vendu(date, "boisson", l.productId);
    report.set(`boisson|${l.productId}`, Math.max(0, ouverture + entree - sold));
    return {
      ...l,
      initialStockGbegamey: Math.round((ouverture / p.upc) * 10000) / 10000,
      purchasesGbegamey: Math.round((entree / p.upc) * 10000) / 10000,
      soldGbegamey: sold,
      pertesGbegamey: 0,
      countedGbegamey: null,
      stockTrackedGbegamey: true,
    };
  });
  if (!dryRun) {
    const set = { transferLines, localLines, updatedAt: new Date().toISOString(), source: "inventaire-gbegamey" };
    if (premier) set.ventesSansStock = false;
    await db.collection("gbegamey_jours").updateOne({ _id: date }, { $set: set, $inc: { rev: 1 }, $setOnInsert: { status: "ouverte" } }, { upsert: true });
    if (boi) await db.collection("boissons_jours").updateOne({ _id: date }, { $set: { lines, updatedAt: new Date().toISOString() }, $inc: { rev: 1 } });
  }
  if (!boi) console.log(`⚠ boissons_jours ${date} absent : boissons de ce jour non écrites`);
}

// SI fixe (comptage) au 02/11.
const toutes = [
  ...[...drinks].map(([id, p]) => ["boisson", id, p]),
  ...[...plats].map(([id, p]) => ["plat", id, p]),
  ...[...accs].map(([id, p]) => ["local", id, p]),
];
for (const [kind, id, p] of toutes) {
  finaux.push({ kind, nom: p.name, comptage: p.qty, actuel: report.get(`${kind}|${id}`) ?? p.qty });
  if (!dryRun) {
    await db.collection("stock_si").updateOne(
      { _id: `gbegamey:${kind}:${id}` },
      { $set: { site: "gbegamey", kind, productId: id, si: p.qty, date: DEPART, at: new Date().toISOString() } },
      { upsert: true },
    );
  }
}

const lib = { boisson: "Boisson (bt)", plat: "Plat", local: "Accomp." };
for (const f of finaux) console.log(`${lib[f.kind]} · ${f.nom} : comptage ${f.comptage} → stock au ${JUSQUA} ${f.actuel}`);
const tb = finaux.filter((f) => f.kind === "boisson");
console.log(`Boissons : ${tb.reduce((s, f) => s + f.comptage, 0)} bt comptées → ${tb.reduce((s, f) => s + f.actuel, 0)} bt au ${JUSQUA}`);
console.log(dryRun ? "Simulation : rien n'a été écrit." : "Inventaire enregistré.");
await client.close();
