/**
 * Vide les stocks du jour + supprime les achats boissons enregistrés ce jour
 * (mouvements purchase, quantités purchases*, QR liés).
 * Active la vente libre. Ne touche pas au journal des ventes.
 *
 *   node --env-file=.env.local scripts/vide-stock-et-achats-boissons.mjs
 *   DATE=2026-09-02 node --env-file=.env.local scripts/vide-stock-et-achats-boissons.mjs
 */
import { MongoClient } from "mongodb";

const date =
  process.env.DATE ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Porto-Novo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`DATE invalide : ${date}`);
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
const updatedAt = new Date().toISOString();
const parametres = (await db.collection("parametres").findOne({})) ?? {};
const baseDishes = parametres.baseDishes ?? [];
const localDishes = parametres.localDishes ?? [];
const drinks = parametres.drinks ?? [];
const combos = parametres.combos ?? [];

console.log(`Date ciblée : ${date}`);

/* --- Achats boissons du jour : QR liés aux mouvements --- */
const boissonsBefore = await db.collection("boissons_jours").findOne({ _id: date });
const purchaseMovements = (boissonsBefore?.movements ?? []).filter(
  (m) => m && m.type === "purchase" && !m.cancelledAt,
);
const movementIds = purchaseMovements.map((m) => m.id).filter(Boolean);
console.log(`Achats boissons actifs : ${purchaseMovements.length}`);

if (movementIds.length) {
  const voided = await db.collection("stock_units").updateMany(
    {
      movementId: { $in: movementIds },
      status: { $in: ["prepare", "envoye"] },
    },
    { $set: { status: "perdu", lostAt: updatedAt, updatedAt } },
  );
  console.log(`QR voidés (par movementId) : ${voided.modifiedCount}`);
}

/* Aussi : unités boisson encore en stock créées ce jour */
const voidedByDate = await db.collection("stock_units").updateMany(
  {
    date,
    kind: "boisson",
    status: { $in: ["prepare", "envoye"] },
  },
  { $set: { status: "perdu", lostAt: updatedAt, updatedAt } },
);
console.log(`QR boisson du jour voidés (par date) : ${voidedByDate.modifiedCount}`);

/* --- Remise à zéro des journées stock --- */
const days = {
  zogbo_jours: {
    _id: date,
    status: "ouverte",
    ventesSansStock: true,
    lines: baseDishes.map((d) => ({
      productId: d.id,
      name: d.name,
      stock: 0,
      prepared: 0,
      sentToGbegamey: 0,
      sold: 0,
      counted: null,
      observations: "",
    })),
    accompanimentLines: localDishes.map((d) => ({
      productId: d.id,
      name: d.name,
      prepared: 0,
      sold: 0,
      counted: null,
      observations: "",
    })),
    movements: [],
    updatedAt,
    source: "vide-stock-et-achats-boissons",
  },
  gbegamey_jours: {
    _id: date,
    status: "ouverte",
    ventesSansStock: true,
    transferLines: baseDishes.map((d) => ({
      productId: d.id,
      name: d.name,
      initialStock: 0,
      received: null,
      sold: 0,
      counted: null,
      observations: "",
    })),
    localLines: localDishes.map((d) => ({
      productId: d.id,
      name: d.name,
      initialStock: 0,
      prepared: 0,
      sold: 0,
      counted: null,
      observations: "",
    })),
    updatedAt,
    source: "vide-stock-et-achats-boissons",
  },
  combos_jours: {
    _id: date,
    status: "ouverte",
    lines: combos.map((c) => ({
      productId: c.id,
      name: c.name,
      baseDishName: c.baseDishName ?? null,
      stockZogbo: 0,
      prepared: 0,
      sentToGbegamey: 0,
      soldZogbo: 0,
      countedZogbo: null,
      initialGbegamey: 0,
      soldGbegamey: 0,
      countedGbegamey: null,
      observations: "",
    })),
    movements: [],
    updatedAt,
    source: "vide-stock-et-achats-boissons",
  },
  boissons_jours: {
    _id: date,
    status: "ouverte",
    lines: drinks.map((d) => ({
      productId: d.id,
      name: d.name,
      initialStockZogbo: 0,
      purchasesZogbo: 0,
      soldZogbo: 0,
      pertesZogbo: 0,
      countedZogbo: null,
      initialStockGbegamey: 0,
      purchasesGbegamey: 0,
      soldGbegamey: 0,
      pertesGbegamey: 0,
      countedGbegamey: null,
      observations: "",
    })),
    // Achats du jour retirés (plus de movements purchase)
    movements: [],
    updatedAt,
    source: "vide-stock-et-achats-boissons",
  },
};

for (const [name, doc] of Object.entries(days)) {
  await db.collection(name).replaceOne({ _id: date }, doc, { upsert: true });
  const n = (doc.lines ?? doc.transferLines ?? []).length;
  console.log(`${name} : journée ${date} à zéro (${n} ligne(s)), achats boissons effacés si applicable`);
}

/* QR plats / accompagnements encore en stock ce jour — stock vidé */
const voidedAll = await db.collection("stock_units").updateMany(
  {
    date,
    status: { $in: ["prepare", "envoye"] },
  },
  { $set: { status: "perdu", lostAt: updatedAt, updatedAt } },
);
console.log(`Autres QR du jour voidés : ${voidedAll.modifiedCount}`);

console.log(`ventesSansStock : activé pour ${date}`);
console.log("ventes_log : non touché");

await client.close();
