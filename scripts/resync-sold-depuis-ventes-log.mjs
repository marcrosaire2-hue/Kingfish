/**
 * Réaligne les compteurs `sold` des docs jour sur ventes_log (source de vérité).
 *
 * Usage:
 *   node --env-file=.env.local scripts/resync-sold-depuis-ventes-log.mjs
 *   node --env-file=.env.local scripts/resync-sold-depuis-ventes-log.mjs --apply
 *   node --env-file=.env.local scripts/resync-sold-depuis-ventes-log.mjs --apply 2026-08-12,2026-08-18,2026-08-19
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI manquant");
const apply = process.argv.includes("--apply");
const datesArg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}/.test(a));
const DATES = (datesArg || "2026-08-12,2026-08-18,2026-08-19")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ACTIVE = { $or: [{ cancelledAt: null }, { cancelledAt: { $exists: false } }] };

function key(date, site, kind, productId) {
  return `${date}|${site}|${kind}|${productId}`;
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");

const grouped = await db
  .collection("ventes_log")
  .aggregate([
    { $match: { ...ACTIVE, date: { $in: DATES } } },
    {
      $group: {
        _id: { date: "$date", site: "$site", kind: "$kind", productId: "$productId" },
        qty: { $sum: "$qty" },
        name: { $last: "$name" },
      },
    },
  ])
  .toArray();

const logQty = new Map();
for (const g of grouped) {
  logQty.set(
    key(g._id.date, g._id.site, g._id.kind, g._id.productId),
    { qty: g.qty, name: g.name },
  );
}

const changes = [];

function note(row) {
  if (row.from === row.to) return;
  changes.push(row);
}

for (const date of DATES) {
  const zogbo = await db.collection("zogbo_jours").findOne({ _id: date });
  if (zogbo) {
    const lines = [...(zogbo.lines ?? [])];
    const acc = [...(zogbo.accompanimentLines ?? [])];
    for (const l of lines) {
      const to = logQty.get(key(date, "zogbo", "plat", l.productId))?.qty ?? 0;
      note({
        date, site: "zogbo", kind: "plat", name: l.name,
        productId: l.productId, from: l.sold ?? 0, to,
      });
      l.sold = to;
    }
    for (const l of acc) {
      const to = logQty.get(key(date, "zogbo", "local", l.productId))?.qty ?? 0;
      note({
        date, site: "zogbo", kind: "local", name: l.name,
        productId: l.productId, from: l.sold ?? 0, to,
      });
      l.sold = to;
    }
    if (apply) {
      await db.collection("zogbo_jours").updateOne(
        { _id: date },
        { $set: { lines, accompanimentLines: acc, updatedAt: new Date().toISOString() }, $inc: { rev: 1 } },
      );
    }
  }

  const gbe = await db.collection("gbegamey_jours").findOne({ _id: date });
  if (gbe) {
    const transfer = [...(gbe.transferLines ?? [])];
    const local = [...(gbe.localLines ?? [])];
    for (const l of transfer) {
      const to = logQty.get(key(date, "gbegamey", "plat", l.productId))?.qty ?? 0;
      note({
        date, site: "gbegamey", kind: "plat", name: l.name,
        productId: l.productId, from: l.sold ?? 0, to,
      });
      l.sold = to;
    }
    for (const l of local) {
      const to = logQty.get(key(date, "gbegamey", "local", l.productId))?.qty ?? 0;
      note({
        date, site: "gbegamey", kind: "local", name: l.name,
        productId: l.productId, from: l.sold ?? 0, to,
      });
      l.sold = to;
    }
    if (apply) {
      await db.collection("gbegamey_jours").updateOne(
        { _id: date },
        { $set: { transferLines: transfer, localLines: local, updatedAt: new Date().toISOString() }, $inc: { rev: 1 } },
      );
    }
  }

  const boissons = await db.collection("boissons_jours").findOne({ _id: date });
  if (boissons) {
    const lines = [...(boissons.lines ?? [])];
    for (const l of lines) {
      const z = logQty.get(key(date, "zogbo", "boisson", l.productId))?.qty ?? 0;
      const g = logQty.get(key(date, "gbegamey", "boisson", l.productId))?.qty ?? 0;
      note({
        date, site: "zogbo", kind: "boisson", name: l.name,
        productId: l.productId, from: l.soldZogbo ?? 0, to: z,
      });
      note({
        date, site: "gbegamey", kind: "boisson", name: l.name,
        productId: l.productId, from: l.soldGbegamey ?? 0, to: g,
      });
      l.soldZogbo = z;
      l.soldGbegamey = g;
    }
    if (apply) {
      await db.collection("boissons_jours").updateOne(
        { _id: date },
        { $set: { lines, updatedAt: new Date().toISOString() }, $inc: { rev: 1 } },
      );
    }
  }

  const combos = await db.collection("combos_jours").findOne({ _id: date });
  if (combos) {
    const lines = [...(combos.lines ?? [])];
    for (const l of lines) {
      const z = logQty.get(key(date, "zogbo", "combo", l.productId))?.qty ?? 0;
      const g = logQty.get(key(date, "gbegamey", "combo", l.productId))?.qty ?? 0;
      note({
        date, site: "zogbo", kind: "combo", name: l.name,
        productId: l.productId, from: l.soldZogbo ?? 0, to: z,
      });
      note({
        date, site: "gbegamey", kind: "combo", name: l.name,
        productId: l.productId, from: l.soldGbegamey ?? 0, to: g,
      });
      l.soldZogbo = z;
      l.soldGbegamey = g;
    }
    if (apply) {
      await db.collection("combos_jours").updateOne(
        { _id: date },
        { $set: { lines, updatedAt: new Date().toISOString() }, $inc: { rev: 1 } },
      );
    }
  }
}

console.log(apply ? "APPLIQUÉ" : "DRY-RUN", DATES.join(", "));
console.log(`${changes.length} compteur(s) à aligner\n`);
for (const c of changes) {
  console.log(
    `${c.date} ${c.site.padEnd(8)} ${c.kind.padEnd(7)} ${(c.name || c.productId).slice(0, 32).padEnd(32)} ${c.from} → ${c.to}`,
  );
}

await client.close();
