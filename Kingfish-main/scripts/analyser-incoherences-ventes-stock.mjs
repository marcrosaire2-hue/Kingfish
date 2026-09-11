/**
 * Réconciliation ventes_log ↔ compteurs sold des docs jour,
 * plus surplus / transport / orphelins.
 *
 * Usage: node --env-file=.env.local scripts/analyser-incoherences-ventes-stock.mjs
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI manquant");
const dbName = process.env.MONGODB_DB || "gestion_restaurant";

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const ACTIVE = { $or: [{ cancelledAt: null }, { cancelledAt: { $exists: false } }] };

function key(...parts) {
  return parts.join("|");
}

/** Agrège ventes actives par date|site|kind|productId (pas par nom : aliases). */
async function aggregateVentes() {
  return db
    .collection("ventes_log")
    .aggregate([
      { $match: ACTIVE },
      {
        $group: {
          _id: {
            date: "$date",
            site: "$site",
            kind: "$kind",
            productId: "$productId",
          },
          qty: { $sum: "$qty" },
          amount: { $sum: "$amount" },
          lines: { $sum: 1 },
          name: { $last: "$name" },
        },
      },
    ])
    .toArray();
}

/** Extrait les compteurs sold depuis les docs jour */
async function extractSoldCounters() {
  const out = [];

  const zogboDays = await db.collection("zogbo_jours").find({}).toArray();
  for (const day of zogboDays) {
    const date = day._id;
    for (const l of day.lines ?? []) {
      out.push({
        date,
        site: "zogbo",
        kind: "plat",
        productId: l.productId,
        name: l.name,
        sold: l.sold ?? 0,
        stock: l.stock ?? 0,
        prepared: l.prepared ?? 0,
        sent: l.sentToGbegamey ?? 0,
        pertes: l.pertes ?? 0,
        counted: l.counted ?? null,
        status: day.status,
      });
    }
    for (const l of day.accompanimentLines ?? []) {
      out.push({
        date,
        site: "zogbo",
        kind: "local",
        productId: l.productId,
        name: l.name,
        sold: l.sold ?? 0,
        stock: l.stock ?? l.initialStock ?? 0,
        pertes: l.pertes ?? 0,
        counted: l.counted ?? null,
        status: day.status,
      });
    }
  }

  const zogboByDate = new Map(
    (await db.collection("zogbo_jours").find({}).toArray()).map((d) => [d._id, d]),
  );
  const gbeDays = await db.collection("gbegamey_jours").find({}).toArray();
  for (const day of gbeDays) {
    const date = day._id;
    const sentMap = new Map(
      (zogboByDate.get(date)?.lines ?? []).map((l) => [
        l.productId,
        l.sentToGbegamey ?? 0,
      ]),
    );
    for (const l of day.transferLines ?? []) {
      const sentFromZogbo = sentMap.get(l.productId) ?? 0;
      out.push({
        date,
        site: "gbegamey",
        kind: "plat",
        productId: l.productId,
        name: l.name,
        sold: l.sold ?? 0,
        initialStock: l.initialStock ?? 0,
        sentFromZogbo,
        // received constaté (null = confiance à l'envoi Zogbo)
        receivedConstat: l.received ?? null,
        pertes: l.pertes ?? 0,
        counted: l.counted ?? null,
        status: day.status,
      });
    }
    for (const l of day.localLines ?? []) {
      out.push({
        date,
        site: "gbegamey",
        kind: "local",
        productId: l.productId,
        name: l.name,
        sold: l.sold ?? 0,
        stock: l.stock ?? l.initialStock ?? 0,
        pertes: l.pertes ?? 0,
        counted: l.counted ?? null,
        status: day.status,
      });
    }
  }

  const boissonDays = await db.collection("boissons_jours").find({}).toArray();
  for (const day of boissonDays) {
    const date = day._id;
    for (const l of day.lines ?? []) {
      out.push({
        date,
        site: "zogbo",
        kind: "boisson",
        productId: l.productId,
        name: l.name,
        sold: l.soldZogbo ?? 0,
        initialStock: l.initialStock ?? 0,
        purchases: l.purchases ?? 0,
        pertes: l.pertes ?? 0,
        counted: l.counted ?? null,
        status: day.status,
      });
      out.push({
        date,
        site: "gbegamey",
        kind: "boisson",
        productId: l.productId,
        name: l.name,
        sold: l.soldGbegamey ?? 0,
        initialStock: l.initialStock ?? 0,
        purchases: l.purchases ?? 0,
        pertes: l.pertes ?? 0,
        counted: l.counted ?? null,
        status: day.status,
      });
    }
  }

  const comboDays = await db.collection("combos_jours").find({}).toArray();
  for (const day of comboDays) {
    const date = day._id;
    for (const l of day.lines ?? []) {
      out.push({
        date,
        site: "zogbo",
        kind: "combo",
        productId: l.productId,
        name: l.name,
        sold: l.soldZogbo ?? 0,
        status: day.status,
      });
      out.push({
        date,
        site: "gbegamey",
        kind: "combo",
        productId: l.productId,
        name: l.name,
        sold: l.soldGbegamey ?? 0,
        status: day.status,
      });
    }
  }

  return out;
}

function prevalentMaxSold(c) {
  if (c.kind === "plat" && c.site === "zogbo") {
    if (c.counted != null) return c.counted;
    return Math.max(0, (c.stock ?? 0) - (c.pertes ?? 0));
  }
  if (c.kind === "plat" && c.site === "gbegamey") {
    if (c.counted != null) return c.counted;
    // Même règle métier : available = initial + envoi Zogbo (received null = confiance)
    return Math.max(
      0,
      (c.initialStock ?? 0) + (c.sentFromZogbo ?? 0) - (c.pertes ?? 0),
    );
  }
  if (c.kind === "boisson") {
    // Sans inventaire ni stock de casiers : vente libre → pas de survente
    const hasInv =
      c.counted != null || (c.initialStock ?? 0) + (c.purchases ?? 0) > 0;
    if (!hasInv) return null;
    // counted boissons = bouteilles ; sinon plafond ≈ casiers (approx sans upc)
    if (c.counted != null) return c.counted;
    return null; // éviter faux positifs casiers vs bouteilles
  }
  // local / combo : pas de plafond strict dans le métier
  return null;
}

/** Transport Zogbo → Gbégamey */
async function transportVariances() {
  const dates = new Set();
  const zogbo = await db.collection("zogbo_jours").find({}).toArray();
  const gbe = await db.collection("gbegamey_jours").find({}).toArray();
  for (const d of zogbo) dates.add(d._id);
  for (const d of gbe) dates.add(d._id);

  const byZ = new Map(zogbo.map((d) => [d._id, d]));
  const byG = new Map(gbe.map((d) => [d._id, d]));
  const variances = [];

  for (const date of [...dates].sort()) {
    const z = byZ.get(date);
    const g = byG.get(date);
    const sentMap = new Map();
    for (const l of z?.lines ?? []) {
      sentMap.set(l.productId, {
        name: l.name,
        sent: l.sentToGbegamey ?? 0,
      });
    }
    const recvMap = new Map();
    for (const l of g?.transferLines ?? []) {
      recvMap.set(l.productId, {
        name: l.name,
        received: l.received, // peut être null
      });
    }
    const ids = new Set([...sentMap.keys(), ...recvMap.keys()]);
    for (const id of ids) {
      const s = sentMap.get(id)?.sent ?? 0;
      const recvRaw = recvMap.get(id)?.received;
      // null / undefined = confiance à l'envoi, pas un écart
      if (recvRaw === null || recvRaw === undefined) continue;
      const r = recvRaw;
      if (s !== r) {
        variances.push({
          date,
          productId: id,
          name: sentMap.get(id)?.name ?? recvMap.get(id)?.name ?? id,
          sent: s,
          received: r,
          delta: r - s,
        });
      }
    }
  }
  return variances;
}

const ventes = await aggregateVentes();
const counters = await extractSoldCounters();

const counterMap = new Map();
for (const c of counters) {
  counterMap.set(key(c.date, c.site, c.kind, c.productId), c);
}

const venteMap = new Map();
for (const v of ventes) {
  const k = key(v._id.date, v._id.site, v._id.kind, v._id.productId);
  venteMap.set(k, {
    date: v._id.date,
    site: v._id.site,
    kind: v._id.kind,
    productId: v._id.productId,
    name: v.name,
    qty: v.qty,
    amount: v.amount,
    lines: v.lines,
  });
}

// 1. Écarts ventes_log vs sold
const mismatches = [];
const allKeys = new Set([...counterMap.keys(), ...venteMap.keys()]);
for (const k of allKeys) {
  const [date, site, kind, productId] = k.split("|");
  if (kind === "extra") continue; // pas de compteur stock
  const c = counterMap.get(k);
  const v = venteMap.get(k);
  const soldDoc = c?.sold ?? 0;
  const soldLog = v?.qty ?? 0;
  if (soldDoc !== soldLog) {
    mismatches.push({
      date,
      site,
      kind,
      productId,
      name: v?.name ?? c?.name ?? productId,
      soldDoc,
      soldLog,
      delta: soldLog - soldDoc,
      amountLog: v?.amount ?? 0,
      status: c?.status ?? null,
      hasDayLine: Boolean(c),
      hasVentes: Boolean(v),
    });
  }
}
mismatches.sort((a, b) => a.date.localeCompare(b.date) || a.site.localeCompare(b.site));

// 2. Surplus (sold > plafond)
const oversolds = [];
for (const c of counters) {
  if (c.kind === "local" || c.kind === "combo") continue;
  const max = prevalentMaxSold(c);
  if (max == null) continue;
  if ((c.sold ?? 0) > max) {
    oversolds.push({
      date: c.date,
      site: c.site,
      kind: c.kind,
      name: c.name,
      productId: c.productId,
      sold: c.sold,
      max,
      excess: c.sold - max,
      counted: c.counted,
      stock: c.stock,
      received: c.received,
      pertes: c.pertes,
    });
  }
}

// 3. Transport
const transport = await transportVariances();

// 4. Ventes extra + stats globales
const extras = ventes.filter((v) => v._id.kind === "extra");
const comboVentes = ventes.filter((v) => v._id.kind === "combo");

const cancelled = await db.collection("ventes_log").countDocuments({
  cancelledAt: { $ne: null, $exists: true },
});
const activeCount = await db.collection("ventes_log").countDocuments(ACTIVE);

// Dates avec ventes mais sans doc jour (plats)
const orphanDayVentes = [];
for (const v of ventes) {
  const { date, site, kind } = v._id;
  if (kind === "extra") continue;
  let coll =
    kind === "boisson"
      ? "boissons_jours"
      : kind === "combo"
        ? "combos_jours"
        : site === "zogbo"
          ? "zogbo_jours"
          : "gbegamey_jours";
  const exists = await db.collection(coll).findOne({ _id: date }, { projection: { _id: 1 } });
  if (!exists) {
    orphanDayVentes.push({
      date,
      site,
      kind,
      productId: v._id.productId,
      name: v._id.name,
      qty: v.qty,
      amount: v.amount,
      missingCollection: coll,
    });
  }
}

// Stats CA par date
const caByDate = await db
  .collection("ventes_log")
  .aggregate([
    { $match: ACTIVE },
    {
      $group: {
        _id: { date: "$date", site: "$site" },
        qty: { $sum: "$qty" },
        amount: { $sum: "$amount" },
        lines: { $sum: 1 },
      },
    },
    { $sort: { "_id.date": 1, "_id.site": 1 } },
  ])
  .toArray();

const result = {
  generatedAt: new Date().toISOString(),
  summary: {
    activeVentes: activeCount,
    cancelledVentes: cancelled,
    soldMismatches: mismatches.length,
    oversolds: oversolds.length,
    transportVariances: transport.length,
    orphanDayVentes: orphanDayVentes.length,
    comboVenteGroups: comboVentes.length,
    extraVenteGroups: extras.length,
    mismatchQtyAbs: mismatches.reduce((s, m) => s + Math.abs(m.delta), 0),
    mismatchAmountAbs: mismatches.reduce((s, m) => s + Math.abs(m.amountLog), 0),
  },
  mismatches,
  oversolds,
  transport,
  orphanDayVentes,
  comboVentes: comboVentes.map((v) => ({
    date: v._id.date,
    site: v._id.site,
    productId: v._id.productId,
    name: v._id.name,
    qty: v.qty,
    amount: v.amount,
  })),
  extras: extras.map((v) => ({
    date: v._id.date,
    site: v._id.site,
    productId: v._id.productId,
    name: v._id.name,
    qty: v.qty,
    amount: v.amount,
  })),
  caByDate: caByDate.map((r) => ({
    date: r._id.date,
    site: r._id.site,
    qty: r.qty,
    amount: r.amount,
    lines: r.lines,
  })),
};

console.log(JSON.stringify(result, null, 2));
await client.close();
