/**
 * Projette le stock final AquaPro dans les journées King Fish (cutover).
 *
 * - matières ← aquapro_aliments_sources.stock
 * - Zogbo (plats de base) ← même source, match par nom
 * - Gbégamey (plats locaux) ← même source, match par nom
 * - boissons ← dernier inventaire validé (bouteilles → casiers) en initialStock
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-opening-stock-from-aquapro.mjs
 *   DATE=2026-08-11 node --env-file=.env.local scripts/seed-opening-stock-from-aquapro.mjs
 */
import { MongoClient } from "mongodb";

function normKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function todayPorto() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Porto-Novo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "gestion_restaurant";
  if (!uri) throw new Error("MONGODB_URI manquant");

  const date = process.env.DATE || todayPorto();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const now = new Date().toISOString();
  const summary = { date, matieres: 0, zogbo: 0, gbegameyLocal: 0, boissons: 0 };

  const parametres = await db.collection("parametres").findOne({ _id: "parametres" });
  if (!parametres) throw new Error("parametres manquants — importez d’abord le catalogue AquaPro");

  const rawMaterials = parametres.rawMaterials || [];
  const baseDishes = parametres.baseDishes || [];
  const localDishes = parametres.localDishes || [];
  const drinks = parametres.drinks || [];

  const aliments = await db.collection("aquapro_aliments_sources").find({}).toArray();
  const stockById = new Map();
  const stockByName = new Map();
  for (const a of aliments) {
    const stock = Math.max(0, Number(a.stock) || 0);
    stockById.set(String(a._id), stock);
    const key = normKey(a.designation);
    if (key) stockByName.set(key, stock);
  }

  // —— Matières ——
  if (!rawMaterials.length && aliments.length) {
    console.warn("rawMaterials vides : relancez l’app /api/parametres une fois pour seed auto");
  }
  const matLines = (rawMaterials.length ? rawMaterials : aliments.map((a) => ({
    id: a._id,
    name: a.designation,
  }))).map((m) => {
    const initialStock =
      stockById.get(m.id) ?? stockByName.get(normKey(m.name)) ?? 0;
    if (initialStock > 0) summary.matieres++;
    return {
      productId: m.id,
      name: m.name,
      initialStock,
      purchases: 0,
      consumed: 0,
      counted: initialStock > 0 ? initialStock : null,
      observations: initialStock > 0 ? "Ouverture AquaPro (stock final)" : "",
    };
  });

  await db.collection("matieres_jours").updateOne(
    { _id: date },
    {
      $set: {
        status: "ouverte",
        lines: matLines,
        movements: [],
        updatedAt: now,
        source: "aquapro-opening",
        rev: 1,
      },
      $setOnInsert: { _id: date },
    },
    { upsert: true },
  );

  // —— Zogbo plats de base ——
  const zogboLines = baseDishes.map((d) => {
    const stock = stockByName.get(normKey(d.name)) ?? 0;
    if (stock > 0) summary.zogbo++;
    return {
      productId: d.id,
      name: d.name,
      stock,
      prepared: stock,
      sentToGbegamey: 0,
      sold: 0,
      counted: stock > 0 ? stock : null,
      observations: stock > 0 ? "Ouverture AquaPro (stock final)" : "",
    };
  });
  await db.collection("zogbo_jours").updateOne(
    { _id: date },
    {
      $set: {
        status: "ouverte",
        lines: zogboLines,
        movements: [],
        updatedAt: now,
        source: "aquapro-opening",
        rev: 1,
      },
      $setOnInsert: { _id: date },
    },
    { upsert: true },
  );

  // —— Gbégamey : reçus (base) à 0 + locaux avec stock AquaPro ——
  const transferLines = baseDishes.map((d) => ({
    productId: d.id,
    name: d.name,
    initialStock: 0,
    received: 0,
    sold: 0,
    counted: null,
    observations: "",
  }));
  const localLines = localDishes.map((d) => {
    const stock = stockByName.get(normKey(d.name)) ?? 0;
    if (stock > 0) summary.gbegameyLocal++;
    return {
      productId: d.id,
      name: d.name,
      initialStock: stock,
      prepared: 0,
      sold: 0,
      counted: stock > 0 ? stock : null,
      observations: stock > 0 ? "Ouverture AquaPro (stock final)" : "",
    };
  });
  await db.collection("gbegamey_jours").updateOne(
    { _id: date },
    {
      $set: {
        status: "ouverte",
        transferLines,
        localLines,
        movements: [],
        updatedAt: now,
        source: "aquapro-opening",
        rev: 1,
      },
      $setOnInsert: { _id: date },
    },
    { upsert: true },
  );

  // —— Boissons : dernier inventaire validé → initialStock (casiers) ——
  const inventaires = await db
    .collection("aquapro_inventaires_boisson")
    .find({})
    .sort({ date: 1 })
    .toArray();
  const drinkByName = new Map(drinks.map((d) => [normKey(d.name), d]));
  const latest = new Map();
  for (const inv of inventaires) {
    if (!inv.date) continue;
    if (inv.statut && inv.statut !== "Validé") continue;
    for (const line of inv.lignes || []) {
      const drink = drinkByName.get(normKey(line.designation));
      if (!drink) continue;
      const upc = Math.max(1, Number(drink.unitsPerCasier) || 12);
      const bottles = Math.max(0, Number(line.quantite) || 0);
      const casiers = Math.round((bottles / upc) * 1000) / 1000;
      const prev = latest.get(drink.id);
      if (!prev || inv.date >= prev.date) {
        latest.set(drink.id, { date: inv.date, casiers, bottles });
      }
    }
  }

  const existingBoi = await db.collection("boissons_jours").findOne({ _id: date });
  const boiLines = drinks.map((d) => {
    const hit = latest.get(d.id);
    const opening = hit?.casiers ?? 0;
    if (opening > 0) summary.boissons++;
    const prev = existingBoi?.lines?.find((l) => l.productId === d.id);
    return {
      productId: d.id,
      name: d.name,
      initialStock: opening,
      purchases: prev?.purchases ?? 0,
      soldZogbo: prev?.soldZogbo ?? 0,
      soldGbegamey: prev?.soldGbegamey ?? 0,
      counted: opening > 0 ? opening : null,
      observations:
        opening > 0
          ? `Ouverture AquaPro inventaire ${hit.date} (${hit.bottles} bt)`
          : prev?.observations || "",
    };
  });
  await db.collection("boissons_jours").updateOne(
    { _id: date },
    {
      $set: {
        status: existingBoi?.status || "ouverte",
        lines: boiLines,
        movements: existingBoi?.movements || [],
        updatedAt: now,
        source: "aquapro-opening",
        rev: (existingBoi?.rev || 0) + 1,
      },
      $setOnInsert: { _id: date },
    },
    { upsert: true },
  );

  await db.collection("aquapro_import").updateOne(
    { _id: "latest" },
    { $set: { openingStockAt: now, openingStock: summary } },
    { upsert: true },
  );

  await client.close();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
