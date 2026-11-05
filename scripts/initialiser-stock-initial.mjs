/**
 * Initialise le SI (stock initial fixe) de chaque produit à partir de la
 * première journée où une entrée de stock a réellement été enregistrée, à
 * compter de DEPUIS (31/10/2026 par défaut).
 *
 * - Boissons : achats du site ce jour-là (casiers × bouteilles par casier).
 * - Plats et accompagnements : quantités préparées / reçues ce jour-là.
 *
 * N'écrase jamais un SI déjà enregistré (collection stock_si).
 * Ne modifie aucun stock, aucune vente.
 *
 * Usage :
 *   node --env-file=.env.local scripts/initialiser-stock-initial.mjs --dry-run
 *   node --env-file=.env.local scripts/initialiser-stock-initial.mjs --yes
 */
import { MongoClient } from "mongodb";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}
const depuis = process.env.DEPUIS || "2026-10-31";

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");
const parametres = (await db.collection("parametres").findOne({})) ?? {};
const upcById = new Map(
  (parametres.drinks ?? []).map((d) => [d.id, Math.max(1, Math.round(Number(d.unitsPerCasier) || 24))]),
);

/** clé site:kind:productId → { si, date, name } (premier jour gagnant) */
const premiers = new Map();
function noter(site, kind, productId, name, qty, date) {
  if (!(qty > 0)) return;
  const k = `${site}:${kind}:${productId}`;
  if (!premiers.has(k)) premiers.set(k, { site, kind, productId, name, si: qty, date });
  else if (premiers.get(k).date === date) premiers.get(k).si += qty;
}

const jours = async (col) =>
  db.collection(col).find({ _id: { $gte: depuis } }).sort({ _id: 1 }).toArray();

for (const d of await jours("boissons_jours")) {
  for (const l of d.lines ?? []) {
    const upc = upcById.get(l.productId) ?? 24;
    noter("zogbo", "boisson", l.productId, l.name, Math.round((Number(l.purchasesZogbo) || 0) * upc), d._id);
    noter("gbegamey", "boisson", l.productId, l.name, Math.round((Number(l.purchasesGbegamey) || 0) * upc), d._id);
  }
}
for (const d of await jours("zogbo_jours")) {
  for (const l of d.lines ?? []) noter("zogbo", "plat", l.productId, l.name, Number(l.prepared) || 0, d._id);
  for (const l of d.accompanimentLines ?? []) noter("zogbo", "local", l.productId, l.name, Number(l.prepared) || 0, d._id);
}
for (const d of await jours("gbegamey_jours")) {
  for (const l of d.transferLines ?? []) noter("gbegamey", "plat", l.productId, l.name, Number(l.received) || 0, d._id);
  for (const l of d.localLines ?? []) noter("gbegamey", "local", l.productId, l.name, Number(l.prepared) || 0, d._id);
}

const existants = new Set((await db.collection("stock_si").find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id));
const libelle = { plat: "plat", local: "accompagnement", boisson: "boisson" };
let ecrits = 0;
for (const [k, v] of [...premiers].sort((a, b) => a[0].localeCompare(b[0]))) {
  const deja = existants.has(k);
  console.log(`${v.site} · ${libelle[v.kind]} · ${v.name} : SI ${v.si}${v.kind === "boisson" ? " bt" : ""} (saisi le ${v.date})${deja ? " — déjà enregistré, conservé" : ""}`);
  if (dryRun || deja) continue;
  await db.collection("stock_si").updateOne(
    { _id: k },
    { $setOnInsert: { site: v.site, kind: v.kind, productId: v.productId, si: v.si, date: v.date, at: new Date().toISOString() } },
    { upsert: true },
  );
  ecrits++;
}
console.log(dryRun ? `Simulation : ${premiers.size} SI à enregistrer.` : `${ecrits} SI enregistré(s).`);
await client.close();
