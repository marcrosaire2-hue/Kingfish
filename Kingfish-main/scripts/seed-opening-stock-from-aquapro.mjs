/**
 * Projette le stock final AquaPro dans les journées King Fish (cutover).
 *
 * AquaPro ne couvre que le point de vente Gbégamey : tout son stock y atterrit.
 *
 * - matières ← aquapro_aliments_sources.stock
 * - Gbégamey (plats de base, ligne « reçus ») ← même source, match par nom
 * - Gbégamey (plats locaux) ← même source, match par nom
 * - Zogbo ← ouvert à zéro (aucune donnée de production dans AquaPro)
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

  // —— Garde-fou : projection one-shot, ne jamais écraser une journée réelle ——
  // Le seed ne s'applique qu'à des journées vierges ou issues d'une projection
  // AquaPro antérieure. Une journée réelle (inventaire, report, ventes ou
  // signature) ne doit pas être réécrite : le stock serait perdu.
  const realWork = {
    "zogbo_jours": (d) => (d.lines ?? []).some(
      (l) => (l.sold ?? 0) > 0 || (l.sentToGbegamey ?? 0) > 0 || (l.prepared ?? 0) > 0,
    ),
    "gbegamey_jours": (d) =>
      (d.transferLines ?? []).some(
        (l) => (l.sold ?? 0) > 0 || (l.received ?? 0) > 0,
      ) ||
      (d.localLines ?? []).some(
        (l) => (l.sold ?? 0) > 0 || (l.prepared ?? 0) > 0,
      ),
    "boissons_jours": (d) => (d.lines ?? []).some(
      (l) =>
        (l.soldZogbo ?? 0) > 0 ||
        (l.soldGbegamey ?? 0) > 0 ||
        (l.purchases ?? 0) > 0,
    ),
    "matieres_jours": (d) => (d.lines ?? []).some(
      (l) => (l.purchases ?? 0) > 0 || (l.consumed ?? 0) > 0,
    ),
  };
  for (const [col, worked] of Object.entries(realWork)) {
    const existing = await db.collection(col).findOne({ _id: date });
    if (!existing) continue;
    if (existing.source !== "aquapro-opening" || worked(existing)) {
      console.error(
        `Refus : ${col} ${date} est déjà une journée réelle ` +
          `(source=${existing.source}, statut=${existing.status ?? "?"}). ` +
          `Le seed ne s'applique qu'à une projection vierge — le stock ` +
          `(plats, accompagnements, boissons, matières) serait écrasé.`,
      );
      await client.close();
      process.exit(1);
    }
  }
  const summary = {
    date,
    matieres: 0,
    zogbo: 0,
    gbegameyBase: 0,
    gbegameyLocal: 0,
    boissons: 0,
  };

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

  // —— Zogbo : à zéro ——
  // AquaPro ne couvre que le point de vente Gbégamey : son stock de plats de
  // base est physiquement à Gbégamey, pas à Zogbo. Zogbo ouvre donc vide.
  const zogboLines = baseDishes.map((d) => ({
    productId: d.id,
    name: d.name,
    stock: 0,
    prepared: 0,
    sentToGbegamey: 0,
    sold: 0,
    counted: null,
    observations: "",
  }));
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

  // —— Gbégamey : plats de base + locaux, tous deux avec stock AquaPro ——
  const transferLines = baseDishes.map((d) => {
    const stock = stockByName.get(normKey(d.name)) ?? 0;
    if (stock > 0) summary.gbegameyBase++;
    return {
      productId: d.id,
      name: d.name,
      initialStock: stock,
      received: 0,
      sold: 0,
      counted: stock > 0 ? stock : null,
      observations: stock > 0 ? "Ouverture AquaPro (stock final)" : "",
    };
  });
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
