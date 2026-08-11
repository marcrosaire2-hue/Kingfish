/**
 * Import inventaire marco.xlsx — journée du registre : 2026-08-07
 * (horodatage Africa/Porto-Novo, UTC+1)
 *
 * Usage: node --env-file=.env.local scripts/import-inventaire-marco.mjs
 *    ou: set -a && source .env.local && set +a && node scripts/import-inventaire-marco.mjs
 */
import { MongoClient, ObjectId } from "mongodb";
import { randomBytes } from "crypto";

function id(prefix, name) {
  return `${prefix}-${name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

function newId() {
  return randomBytes(8).toString("hex");
}

/** Horodatage Europe/Porto-Novo (Bénin = UTC+1, pas de DST) */
function at(date, hh, mm = 0, ss = 0) {
  const h = String(hh).padStart(2, "0");
  const m = String(mm).padStart(2, "0");
  const s = String(ss).padStart(2, "0");
  return `${date}T${h}:${m}:${s}.000+01:00`;
}

const DATE = "2026-08-07";
const WRONG_DATE = "2026-08-11";
const OBS = "Inventaire marco.xlsx — stock au 07/08/2026";

/**
 * Zogbo — feuille « Stock Physique Théorique zogbo »
 * prepared / sent / sold / counted (restant physique)
 */
const ZOGBO = [
  { name: "Attasi", prepared: 100, sent: 55, sold: 23, counted: 19 },
  { name: "Brochette de poisson", prepared: 67, sent: 21, sold: 4, counted: 21 },
  { name: "Choucouya", prepared: 31, sent: 10, sold: 0, counted: 7 },
  { name: "Friture", prepared: 50, sent: 55, sold: 0, counted: 21 },
  { name: "Poisson Chawarma", prepared: 120, sent: 75, sold: 4, counted: 38 },
  { name: "Poisson pané", prepared: 49, sent: 30, sold: 4, counted: 0 },
  { name: "Sauce arachide", prepared: 50, sent: 13, sold: 2, counted: 16 },
  { name: "Sauce graine", prepared: 50, sent: 33, sold: 14, counted: 8 },
  { name: "Sauce légume", prepared: 41, sent: 20, sold: 4, counted: 10 },
  { name: "Sauce Monyo", prepared: 86, sent: 65, sold: 9, counted: 5 },
  { name: "Sauce Tchayo", prepared: 50, sent: 25, sold: 4, counted: 19 },
  { name: "Sauce tomate", prepared: 96, sent: 58, sold: 7, counted: 18 },
];

/** Gbégamey — plats reçus de Zogbo */
const GBEGAMEY_TRANSFER = [
  { name: "Attasi", received: 45, sold: 10, counted: 31 },
  { name: "Brochette de poisson", received: 31, sold: 16, counted: 14 },
  { name: "Choucouya", received: 0, sold: 0, counted: 0 },
  { name: "Friture", received: 25, sold: 13, counted: 21 },
  { name: "Poisson Chawarma", received: 75, sold: 68, counted: 16 },
  { name: "Poisson pané", received: 35, sold: 25, counted: 21 },
  { name: "Sauce arachide", received: 21, sold: 1, counted: 20 },
  { name: "Sauce graine", received: 26, sold: 1, counted: 21 },
  { name: "Sauce légume", received: 25, sold: 8, counted: 17 },
  { name: "Sauce Monyo", received: 62, sold: 9, counted: 57 },
  { name: "Sauce Tchayo", received: 49, sold: 30, counted: 21 },
  { name: "Sauce tomate", received: 35, sold: 8, counted: 12 },
];

/** Gbégamey — plats locaux (ventes du point) */
const GBEGAMEY_LOCAL = [
  { name: "Frites", prepared: 21, sold: 21, counted: 0, unitPrice: 500 },
  { name: "Riz", prepared: 32, sold: 32, counted: 0, unitPrice: 500 },
  { name: "Légume sauté", prepared: 11, sold: 11, counted: 0, unitPrice: 1000 },
  { name: "Pâte de Maïs", prepared: 1, sold: 1, counted: 0, unitPrice: 500 },
  { name: "Pate noire", prepared: 9, sold: 9, counted: 0, unitPrice: 500 },
  { name: "Piron blanc", prepared: 6, sold: 6, counted: 0, unitPrice: 500 },
  { name: "Piron rouge", prepared: 1, sold: 1, counted: 0, unitPrice: 500 },
  { name: "Spaghetti", prepared: 13, sold: 13, counted: 0, unitPrice: 500 },
  { name: "Telibo", prepared: 9, sold: 9, counted: 0, unitPrice: 500 },
  { name: "Wassa Wassa", prepared: 2, sold: 2, counted: 0, unitPrice: 500 },
];

/** Combos vendus à Zogbo (lignes bas inventaire) */
const COMBOS_SOLD_ZOGBO = [
  { name: "Sauce tomate + riz", qty: 1, unitPrice: 2000, baseDishName: "Sauce tomate" },
  { name: "Sauce graine + placali", qty: 1, unitPrice: 2000, baseDishName: "Sauce graine" },
  { name: "Sauce Tchayo + riz", qty: 2, unitPrice: 2000, baseDishName: "Sauce Tchayo" },
  { name: "Poisson pané + riz", qty: 1, unitPrice: 2000, baseDishName: "Poisson pané" },
  { name: "Atassi + accompagnement", qty: 4, unitPrice: 2500, baseDishName: "Attasi" },
  { name: "Œuf", qty: 1, unitPrice: 150, baseDishName: null },
  { name: "Brochette de poisson + riz", qty: 1, unitPrice: 1000, baseDishName: "Brochette de poisson" },
  { name: "Sauce Tchayo (portion seule)", qty: 1, unitPrice: 1000, baseDishName: "Sauce Tchayo" },
];

const DRINKS = [
  ["Flag GB", 600],
  ["Beaufort GB", 600],
  ["Beaufort PB", 350],
  ["Béninoise GB", 600],
  ["Béninoise PB", 350],
  ["Kankpe GB", 600],
  ["Castel GB", 500],
  ["Chill GB", 500],
  ["Chill PM", 400],
  ["Doppel GB", 600],
  ["Lager GB", 600],
  ["FIFA GB", 600],
  ["HAGBE GB", 800],
  ["GUINNESS PM", 700],
  ["EKU PM", 600],
  ["PILS GM", 800],
  ["Kiwabo GB", 600],
  ["CONTESSE FRUIT", 600],
  ["POSSOTOME", 600],
  ["POSSOTOME CITRON", 600],
  ["Coca Cola GB", 500],
  ["Coca Cola PB", 300],
  ["Cocktail GB", 500],
  ["Cocktail PB", 300],
  ["Moka GB", 500],
  ["Moka PB", 300],
  ["Pamplemousse GB", 500],
  ["Pamplemousse PB", 300],
  ["Youzou Sprite GB", 500],
  ["Youzou Sprite PB", 300],
].map(([name, price]) => ({
  id: id("drink", name),
  name,
  purchasePrice: price,
  salePrice: price,
}));

const BASE_DISHES = ZOGBO.map((r) => ({
  id: id("base", r.name),
  name: r.name,
  unitPrice: 1500,
}));

const COMBOS = COMBOS_SOLD_ZOGBO.map((c) => ({
  id: id("combo", c.name),
  name: c.name,
  unitPrice: c.unitPrice,
  baseDishName: c.baseDishName,
}));

const LOCAL_DISHES = GBEGAMEY_LOCAL.map((r) => ({
  id: id("local", r.name),
  name: r.name,
  unitPrice: r.unitPrice,
}));

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "gestion_restaurant";
  if (!uri) throw new Error("MONGODB_URI manquant");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const now = at(DATE, 22, 30);

  // Nettoyer l’ancien import (mauvaise date) + réimport du 07/08
  for (const col of [
    "zogbo_jours",
    "gbegamey_jours",
    "combos_jours",
    "boissons_jours",
  ]) {
    await db.collection(col).deleteMany({
      _id: { $in: [DATE, WRONG_DATE] },
    });
  }
  await db.collection("ventes_log").deleteMany({
    date: { $in: [DATE, WRONG_DATE] },
    name: { $regex: /marco|Import inventaire/i },
  });
  // Ventes créées par import précédent sans marqueur : on purge la journée inventaire
  await db.collection("ventes_log").deleteMany({ date: DATE });
  await db.collection("historique").deleteMany({
    date: { $in: [DATE, WRONG_DATE] },
    detail: { $regex: /marco|Inventaire marco/i },
  });

  const parametres = {
    baseDishes: BASE_DISHES,
    combos: COMBOS,
    drinks: DRINKS,
    localDishes: LOCAL_DISHES,
    updatedAt: now,
  };
  await db.collection("parametres").updateOne(
    { _id: "parametres" },
    { $set: { _id: "parametres", ...parametres } },
    { upsert: true },
  );

  // ——— Zogbo : préparations (matin) + envois (milieu de matinée) ———
  const zogboMovements = [];
  let prepareMinute = 0;
  let sendMinute = 0;

  const zogboLines = ZOGBO.map((row, idx) => {
    const productId = id("base", row.name);
    const preparedQty = Math.max(row.prepared, row.sent);
    const sentQty = row.sent;
    const stock = Math.max(0, preparedQty - sentQty);

    const prepAt = at(DATE, 7, prepareMinute % 60, idx);
    prepareMinute += 4;
    zogboMovements.push({
      id: newId(),
      at: prepAt,
      type: "prepare",
      productId,
      name: row.name,
      qty: preparedQty,
      stockAfter: preparedQty,
      cancelledAt: null,
    });

    if (sentQty > 0) {
      const sendAt = at(DATE, 9, sendMinute % 60, idx);
      sendMinute += 3;
      zogboMovements.push({
        id: newId(),
        at: sendAt,
        type: "send",
        productId,
        name: row.name,
        qty: sentQty,
        stockAfter: stock,
        cancelledAt: null,
      });
    }

    return {
      productId,
      name: row.name,
      stock,
      prepared: preparedQty,
      sentToGbegamey: sentQty,
      sold: row.sold,
      counted: row.counted,
      observations: OBS,
    };
  });

  zogboMovements.sort((a, b) => a.at.localeCompare(b.at));

  await db.collection("zogbo_jours").insertOne({
    _id: DATE,
    status: "cloturee",
    lines: zogboLines,
    movements: zogboMovements,
    updatedAt: now,
    rev: 1,
  });

  // ——— Gbégamey ———
  const byName = Object.fromEntries(GBEGAMEY_TRANSFER.map((r) => [r.name, r]));
  const transferLines = BASE_DISHES.map((d) => {
    const row = byName[d.name] ?? { received: 0, sold: 0, counted: 0 };
    return {
      productId: d.id,
      name: d.name,
      initialStock: 0,
      received: row.received,
      sold: row.sold,
      counted: row.counted,
      observations: OBS,
    };
  });

  const localLines = GBEGAMEY_LOCAL.map((r) => ({
    productId: id("local", r.name),
    name: r.name,
    initialStock: 0,
    prepared: r.prepared,
    sold: r.sold,
    counted: r.counted,
    observations: OBS,
  }));

  await db.collection("gbegamey_jours").insertOne({
    _id: DATE,
    status: "cloturee",
    transferLines,
    localLines,
    updatedAt: now,
    rev: 1,
  });

  // ——— Combos ———
  const combosLines = COMBOS.map((c) => {
    const sold = COMBOS_SOLD_ZOGBO.find((x) => x.name === c.name)?.qty ?? 0;
    return {
      productId: c.id,
      name: c.name,
      baseDishName: c.baseDishName,
      stockZogbo: 0,
      prepared: sold,
      sentToGbegamey: 0,
      soldZogbo: sold,
      countedZogbo: 0,
      initialGbegamey: 0,
      soldGbegamey: 0,
      countedGbegamey: null,
      observations: OBS,
    };
  });

  const comboMovements = [];
  let comboMin = 0;
  for (const c of COMBOS) {
    const sold = COMBOS_SOLD_ZOGBO.find((x) => x.name === c.name)?.qty ?? 0;
    if (sold <= 0) continue;
    comboMovements.push({
      id: newId(),
      at: at(DATE, 8, comboMin, 0),
      type: "prepare",
      productId: c.id,
      name: c.name,
      qty: sold,
      stockAfter: sold,
      cancelledAt: null,
    });
    comboMin += 5;
  }

  await db.collection("combos_jours").insertOne({
    _id: DATE,
    status: "cloturee",
    lines: combosLines,
    movements: comboMovements,
    updatedAt: now,
    rev: 1,
  });

  await db.collection("boissons_jours").insertOne({
    _id: DATE,
    status: "cloturee",
    lines: DRINKS.map((d) => ({
      productId: d.id,
      name: d.name,
      initialStock: 0,
      purchases: 0,
      soldZogbo: 0,
      soldGbegamey: 0,
      counted: null,
      observations: "Feuille boissons vide dans l’Excel",
    })),
    movements: [],
    updatedAt: now,
    rev: 1,
  });

  // ——— Journal des ventes (Registre) avec heures du 07/08/2026 ———
  const ventes = [];
  let venteHour = 10;
  let venteMin = 0;

  function nextVenteAt() {
    const t = at(DATE, venteHour, venteMin, Math.floor(Math.random() * 50));
    venteMin += 7;
    if (venteMin >= 60) {
      venteMin = 0;
      venteHour += 1;
    }
    if (venteHour > 21) venteHour = 12;
    return t;
  }

  for (const row of ZOGBO) {
    if (row.sold <= 0) continue;
    ventes.push({
      _id: new ObjectId(),
      date: DATE,
      site: "zogbo",
      kind: "plat",
      productId: id("base", row.name),
      name: row.name,
      qty: row.sold,
      unitPrice: 1500,
      costPrice: 0,
      amount: row.sold * 1500,
      at: nextVenteAt(),
      cancelledAt: null,
    });
  }

  for (const c of COMBOS_SOLD_ZOGBO) {
    if (c.qty <= 0) continue;
    ventes.push({
      _id: new ObjectId(),
      date: DATE,
      site: "zogbo",
      kind: "combo",
      productId: id("combo", c.name),
      name: c.name,
      qty: c.qty,
      unitPrice: c.unitPrice,
      costPrice: 0,
      amount: c.qty * c.unitPrice,
      at: nextVenteAt(),
      cancelledAt: null,
    });
  }

  for (const row of GBEGAMEY_TRANSFER) {
    if (row.sold <= 0) continue;
    ventes.push({
      _id: new ObjectId(),
      date: DATE,
      site: "gbegamey",
      kind: "plat",
      productId: id("base", row.name),
      name: row.name,
      qty: row.sold,
      unitPrice: 1000,
      costPrice: 0,
      amount: row.sold * 1000,
      at: nextVenteAt(),
      cancelledAt: null,
    });
  }

  for (const row of GBEGAMEY_LOCAL) {
    if (row.sold <= 0) continue;
    ventes.push({
      _id: new ObjectId(),
      date: DATE,
      site: "gbegamey",
      kind: "local",
      productId: id("local", row.name),
      name: row.name,
      qty: row.sold,
      unitPrice: row.unitPrice,
      costPrice: 0,
      amount: row.sold * row.unitPrice,
      at: nextVenteAt(),
      cancelledAt: null,
    });
  }

  ventes.sort((a, b) => a.at.localeCompare(b.at));
  if (ventes.length) await db.collection("ventes_log").insertMany(ventes);

  // Événements historique (préparations / transferts)
  const hist = [
    {
      _id: new ObjectId(),
      at: at(DATE, 7, 0),
      date: DATE,
      kind: "zogbo",
      site: "zogbo",
      title: "Import inventaire Zogbo",
      detail: `Inventaire marco.xlsx · ${zogboMovements.filter((m) => m.type === "prepare").length} préparations`,
      actorId: null,
      actorName: "Import Excel",
      amount: null,
    },
    {
      _id: new ObjectId(),
      at: at(DATE, 9, 0),
      date: DATE,
      kind: "transfert",
      site: "zogbo",
      title: "Envois Zogbo → Gbégamey",
      detail: `Inventaire marco.xlsx · ${zogboMovements.filter((m) => m.type === "send").length} envois`,
      actorId: null,
      actorName: "Import Excel",
      amount: null,
    },
    {
      _id: new ObjectId(),
      at: at(DATE, 22, 0),
      date: DATE,
      kind: "gbegamey",
      site: "gbegamey",
      title: "Clôture inventaire Gbégamey",
      detail: "Inventaire marco.xlsx · stocks comptés au 07/08/2026",
      actorId: null,
      actorName: "Import Excel",
      amount: null,
    },
  ];
  await db.collection("historique").insertMany(hist);

  const ca = ventes.reduce((s, v) => s + v.amount, 0);
  console.log(
    JSON.stringify(
      {
        ok: true,
        dateRegistre: DATE,
        timezone: "UTC+1 (Bénin)",
        mouvementsZogbo: zogboMovements.length,
        ventesJournal: ventes.length,
        caJournalFcfa: ca,
        premiereVente: ventes[0]?.at ?? null,
        derniereVente: ventes[ventes.length - 1]?.at ?? null,
        journee: "cloturee",
        note: "Ouvrir la date 07/08/2026 dans Zogbo / Vente / Registre",
      },
      null,
      2,
    ),
  );

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
