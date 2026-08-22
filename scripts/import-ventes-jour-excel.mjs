/**
 * Importe KingFish-Ventes-Jour.xlsx → ventes_log (plat, accompagnement, boisson).
 * Sans combos. Réaligne ensuite les compteurs sold.
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-ventes-jour-excel.mjs --dry-run
 *   node --env-file=.env.local scripts/import-ventes-jour-excel.mjs --apply
 *   node --env-file=.env.local scripts/import-ventes-jour-excel.mjs --apply --file exports/KingFish-Ventes-Jour.xlsx
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx-js-style";
import { MongoClient, ObjectId } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE = "excel-ventes-jour";
const ACTIVE = { $or: [{ cancelledAt: null }, { cancelledAt: { $exists: false } }] };

const args = new Set(process.argv.slice(2));
const dryRun = !args.has("--apply");
const fileArg = process.argv.find((a) => a.startsWith("--file="));
const FILE = fileArg
  ? fileArg.slice("--file=".length)
  : path.join(ROOT, "KingFish-Ventes-Jour.xlsx");

function categorieToKind(cat) {
  const c = String(cat || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (c === "plat") return "plat";
  if (c === "accompagnement" || c === "accomp") return "local";
  if (c === "boisson") return "boisson";
  return null;
}

function normName(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function isHintRow(firstCell) {
  const v = String(firstCell || "").trim();
  return v.startsWith("→") || v.startsWith("King Fish");
}

function parseQty(raw) {
  const n = Math.round(Number(String(raw ?? "").replace(",", ".")));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function sheetToRows(wb, name, headerRow = 2) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false, range: headerRow });
  return rows.filter((row) => {
    const first = Object.values(row)[0];
    if (isHintRow(first)) return false;
    return Object.values(row).some((v) => String(v).trim() !== "");
  });
}

function parseJourSheet(name, rows) {
  const m = name.match(/^J_(\d{4}-\d{2}-\d{2})_(Z|G)$/i);
  if (!m) return [];
  const date = m[1];
  const site = m[2].toUpperCase() === "G" ? "gbegamey" : "zogbo";
  const out = [];
  for (const row of rows) {
    const produit = row.Produit ?? row.produit ?? "";
    const categorie = row.Catégorie ?? row.Categorie ?? row.catégorie ?? "";
    const qty = parseQty(row.Quantité ?? row.Quantite ?? row.quantité);
    if (!produit || !qty) continue;
    out.push({ Date: date, Site: site, Catégorie: categorie, Produit: produit, Quantité: qty });
  }
  return out;
}

function parseVentesSheet(rows) {
  const out = [];
  for (const row of rows) {
    const date = String(row.Date ?? row.date ?? "").trim();
    const site = String(row.Site ?? row.site ?? "")
      .trim()
      .toLowerCase();
    const categorie = row.Catégorie ?? row.Categorie ?? row.catégorie ?? "";
    const produit = row.Produit ?? row.produit ?? "";
    const qty = parseQty(row.Quantité ?? row.Quantite ?? row.quantité);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (site !== "zogbo" && site !== "gbegamey") continue;
    if (!produit || !qty) continue;
    out.push({ Date: date, Site: site, Catégorie: categorie, Produit: produit, Quantité: qty });
  }
  return out;
}

function buildCatalog(parametres) {
  const byName = new Map();
  const add = (categorie, item, unitPrice) => {
    if (!item?.name || !item?.id) return;
    byName.set(`${categorie}|${normName(item.name)}`, {
      categorie,
      kind: categorieToKind(categorie),
      productId: item.id,
      name: item.name,
      unitPrice: Number(unitPrice) || 0,
    });
  };
  for (const d of parametres.baseDishes ?? []) add("plat", d, d.unitPrice);
  for (const d of parametres.localDishes ?? []) add("accompagnement", d, d.unitPrice);
  for (const d of parametres.drinks ?? []) {
    if (d.salePrice == null) continue;
    add("boisson", d, d.salePrice);
  }
  return byName;
}

function mergeRows(rawRows) {
  const map = new Map();
  for (const row of rawRows) {
    const kind = categorieToKind(row.Catégorie);
    if (!kind) continue;
    const cat =
      kind === "plat"
        ? "plat"
        : kind === "local"
          ? "accompagnement"
          : "boisson";
    const key = `${row.Date}|${row.Site}|${cat}|${normName(row.Produit)}`;
    const prev = map.get(key);
    if (prev) prev.Quantité += row.Quantité;
    else map.set(key, { ...row, Catégorie: cat, kind });
  }
  return [...map.values()];
}

function keySold(date, site, kind, productId) {
  return `${date}|${site}|${kind}|${productId}`;
}

async function resyncSold(db, dates) {
  const changes = [];
  for (const date of dates) {
    const grouped = await db
      .collection("ventes_log")
      .aggregate([
        { $match: { ...ACTIVE, date } },
        {
          $group: {
            _id: { site: "$site", kind: "$kind", productId: "$productId" },
            qty: { $sum: "$qty" },
            name: { $last: "$name" },
          },
        },
      ])
      .toArray();

    const logQty = new Map();
    for (const g of grouped) {
      if (!["plat", "local", "boisson"].includes(g._id.kind)) continue;
      logQty.set(
        keySold(date, g._id.site, g._id.kind, g._id.productId),
        g.qty,
      );
    }

    const zogbo = await db.collection("zogbo_jours").findOne({ _id: date });
    if (zogbo) {
      const lines = [...(zogbo.lines ?? [])];
      const acc = [...(zogbo.accompanimentLines ?? [])];
      for (const l of lines) {
        const to = logQty.get(keySold(date, "zogbo", "plat", l.productId)) ?? 0;
        if ((l.sold ?? 0) !== to) changes.push({ date, site: "zogbo", kind: "plat", name: l.name, from: l.sold ?? 0, to });
        l.sold = to;
      }
      for (const l of acc) {
        const to = logQty.get(keySold(date, "zogbo", "local", l.productId)) ?? 0;
        if ((l.sold ?? 0) !== to) changes.push({ date, site: "zogbo", kind: "local", name: l.name, from: l.sold ?? 0, to });
        l.sold = to;
      }
      await db.collection("zogbo_jours").updateOne(
        { _id: date },
        { $set: { lines, accompanimentLines: acc, updatedAt: new Date().toISOString() } },
      );
    }

    const gbe = await db.collection("gbegamey_jours").findOne({ _id: date });
    if (gbe) {
      const lines = [...(gbe.lines ?? [])];
      const acc = [...(gbe.accompanimentLines ?? [])];
      for (const l of lines) {
        const to = logQty.get(keySold(date, "gbegamey", "plat", l.productId)) ?? 0;
        if ((l.sold ?? 0) !== to) changes.push({ date, site: "gbegamey", kind: "plat", name: l.name, from: l.sold ?? 0, to });
        l.sold = to;
      }
      for (const l of acc) {
        const to = logQty.get(keySold(date, "gbegamey", "local", l.productId)) ?? 0;
        if ((l.sold ?? 0) !== to) changes.push({ date, site: "gbegamey", kind: "local", name: l.name, from: l.sold ?? 0, to });
        l.sold = to;
      }
      await db.collection("gbegamey_jours").updateOne(
        { _id: date },
        { $set: { lines, accompanimentLines: acc, updatedAt: new Date().toISOString() } },
      );
    }

    const boissons = await db.collection("boissons_jours").findOne({ _id: date });
    if (boissons?.lines) {
      const lines = [...boissons.lines];
      for (const l of lines) {
        const z = logQty.get(keySold(date, "zogbo", "boisson", l.productId)) ?? 0;
        const g = logQty.get(keySold(date, "gbegamey", "boisson", l.productId)) ?? 0;
        if ((l.soldZogbo ?? 0) !== z) changes.push({ date, site: "zogbo", kind: "boisson", name: l.name, from: l.soldZogbo ?? 0, to: z });
        if ((l.soldGbegamey ?? 0) !== g) changes.push({ date, site: "gbegamey", kind: "boisson", name: l.name, from: l.soldGbegamey ?? 0, to: g });
        l.soldZogbo = z;
        l.soldGbegamey = g;
      }
      await db.collection("boissons_jours").updateOne(
        { _id: date },
        { $set: { lines, updatedAt: new Date().toISOString() } },
      );
    }
  }
  return changes;
}

async function protectedVenteIds(db, date, site) {
  const tickets = await db
    .collection("pos_tickets")
    .find({ date, site, statut: { $ne: "annule" } })
    .project({ lines: 1 })
    .toArray();
  const ids = new Set();
  for (const t of tickets) {
    for (const l of t.lines ?? []) {
      if (l.venteLogId) ids.add(l.venteLogId);
    }
  }
  return ids;
}

async function main() {
  if (!existsSync(FILE)) {
    throw new Error(
      `Fichier introuvable : ${FILE}\nGénérez-le : npm run excel:ventes`,
    );
  }

  const wb = XLSX.read(readFileSync(FILE), { type: "buffer" });
  let rawRows = parseVentesSheet(sheetToRows(wb, "Ventes"));
  for (const name of wb.SheetNames) {
    if (name.startsWith("J_")) {
      rawRows.push(...parseJourSheet(name, sheetToRows(wb, name)));
    }
  }

  if (!rawRows.length) {
    throw new Error("Aucune ligne de vente trouvée dans le classeur.");
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");
  const parametres = await db.collection("parametres").findOne({ _id: "parametres" });
  if (!parametres) throw new Error("Catalogue parametres manquant");

  const catalog = buildCatalog(parametres);
  const merged = mergeRows(rawRows);
  const resolved = [];
  const errors = [];

  for (const row of merged) {
    const cat = row.Catégorie;
    const hit = catalog.get(`${cat}|${normName(row.Produit)}`);
    if (!hit) {
      errors.push(`${row.Date} ${row.Site} · ${cat} · ${row.Produit} — produit inconnu`);
      continue;
    }
    if (hit.kind !== row.kind) {
      errors.push(`${row.Date} ${row.Site} · ${row.Produit} — catégorie incohérente`);
      continue;
    }
    resolved.push({
      date: row.Date,
      site: row.Site,
      kind: hit.kind,
      productId: hit.productId,
      name: hit.name,
      qty: row.Quantité,
      unitPrice: hit.unitPrice,
      amount: row.Quantité * hit.unitPrice,
    });
  }

  const daySites = [...new Set(resolved.map((r) => `${r.date}|${r.site}`))].sort();
  const dates = [...new Set(resolved.map((r) => r.date))].sort();
  const ca = resolved.reduce((s, r) => s + r.amount, 0);

  const plan = [];
  for (const ds of daySites) {
    const [date, site] = ds.split("|");
    const protectedIds = await protectedVenteIds(db, date, site);
    const toDelete = await db.collection("ventes_log").countDocuments({
      ...ACTIVE,
      date,
      site,
      kind: { $in: ["plat", "local", "boisson"] },
      _id: {
        $nin: [...protectedIds]
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id)),
      },
    });
    const insertCount = resolved.filter((r) => r.date === date && r.site === site).length;
    plan.push({ date, site, deleteCount: toDelete, insertCount, protectedPos: protectedIds.size });
  }

  const summary = {
    mode: dryRun ? "dry-run" : "apply",
    file: FILE,
    source: SOURCE,
    lignesExcel: rawRows.length,
    lignesFusionnees: merged.length,
    lignesImportees: resolved.length,
    erreurs: errors.length,
    caTotal: ca,
    jours: daySites.length,
    plan,
  };

  if (errors.length) summary.exemplesErreurs = errors.slice(0, 15);

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    if (errors.length) process.exitCode = 1;
    await client.close();
    return;
  }

  if (errors.length) {
    throw new Error(`${errors.length} erreur(s) — corrigez le classeur avant --apply`);
  }

  for (const ds of daySites) {
    const [date, site] = ds.split("|");
    const protectedIds = await protectedVenteIds(db, date, site);
    await db.collection("ventes_log").deleteMany({
      ...ACTIVE,
      date,
      site,
      kind: { $in: ["plat", "local", "boisson"] },
      _id: {
        $nin: [...protectedIds]
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id)),
      },
    });

    const batch = resolved.filter((r) => r.date === date && r.site === site);
    let h = 10;
    let m = 0;
    const docs = batch.map((r) => {
      const at = `${r.date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000+01:00`;
      m += 3;
      if (m >= 60) {
        h += 1;
        m = 0;
      }
      return {
        _id: new ObjectId(),
        date: r.date,
        site: r.site,
        kind: r.kind,
        productId: r.productId,
        name: r.name,
        qty: r.qty,
        unitPrice: r.unitPrice,
        costPrice: 0,
        amount: r.amount,
        at,
        cancelledAt: null,
        caExcluded: false,
        shift: "aucune",
        source: SOURCE,
        note: "Import Excel ventes jour",
      };
    });
    if (docs.length) await db.collection("ventes_log").insertMany(docs);
  }

  const soldChanges = await resyncSold(db, dates);

  console.log(
    JSON.stringify(
      {
        ...summary,
        soldAdjustments: soldChanges.length,
        soldSample: soldChanges.slice(0, 10),
      },
      null,
      2,
    ),
  );

  await client.close();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
