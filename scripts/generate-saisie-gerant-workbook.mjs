/**
 * Génère le classeur Excel ventes par jour (plat, accompagnement, boisson).
 *
 * Usage:
 *   node scripts/generate-saisie-gerant-workbook.mjs
 *   node --env-file=.env.local scripts/generate-saisie-gerant-workbook.mjs --from-db
 */
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx-js-style";
import { MongoClient } from "mongodb";
import {
  GUIDE,
  VENTES_FIELDS,
  buildDaySheetRows,
  buildVentesRows,
  kindToCategorie,
} from "./saisie-gerant-schema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "exports");
const OUT_FILE = path.join(OUT_DIR, "KingFish-Ventes-Jour.xlsx");
const FROM_DB = process.argv.includes("--from-db");

const BLEU = "004888";
const GRIS_LIGNE = "F2F6FA";
const BORDURE = "D5E0EC";
const ROSE_CLAIR = "FFF3E0";

function styleCell(v, opts = {}) {
  const isNum = typeof v === "number";
  return {
    v: v ?? "",
    t: isNum ? "n" : "s",
    s: {
      font: {
        sz: opts.small ? 9 : 10,
        bold: !!opts.bold,
        italic: !!opts.italic,
        color: opts.color ? { rgb: opts.color } : undefined,
      },
      fill: opts.fill ? { fgColor: { rgb: opts.fill } } : undefined,
      alignment: {
        horizontal: isNum ? "right" : "left",
        vertical: "center",
        wrapText: true,
      },
      border: {
        top: { style: "thin", color: { rgb: BORDURE } },
        bottom: { style: "thin", color: { rgb: BORDURE } },
        left: { style: "thin", color: { rgb: BORDURE } },
        right: { style: "thin", color: { rgb: BORDURE } },
      },
    },
  };
}

function buildSheet(rows, title, subtitle) {
  if (!rows.length) rows = [{ Info: "—" }];
  const keys = Object.keys(rows[0]);
  const grid = [];
  grid.push([styleCell(title, { bold: true, color: BLEU })]);
  grid.push([styleCell(subtitle || "", { color: "5A7A9A", small: true })]);
  grid.push(keys.map((k) => styleCell(k, { bold: true, fill: BLEU, color: "FFFFFF" })));
  rows.forEach((row, i) => {
    const isHint = String(row[keys[0]] || "").startsWith("→");
    grid.push(
      keys.map((k) =>
        styleCell(row[k], {
          fill: isHint ? ROSE_CLAIR : i % 2 ? GRIS_LIGNE : undefined,
          italic: isHint,
          bold: isHint,
        }),
      ),
    );
  });
  const ws = XLSX.utils.aoa_to_sheet(grid.map((r) => r.map((c) => c.v)));
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: "s", v: "" };
      if (grid[r][c].s) ws[addr].s = grid[r][c].s;
    }
  }
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(keys.length - 1, 0) } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(keys.length - 1, 0) } },
  ];
  ws["!cols"] = keys.map((k) => ({
    wch: Math.min(36, Math.max(10, String(k).length + 2)),
  }));
  ws["!rows"] = [{ hpt: 24 }, { hpt: 36 }];
  ws["!freeze"] = { xSplit: 0, ySplit: 3 };
  return ws;
}

function buildCatalog(parametres) {
  const catalog = [];
  for (const d of parametres.baseDishes ?? []) {
    catalog.push({
      categorie: "plat",
      name: d.name,
      productId: d.id,
      unitPrice: d.unitPrice,
    });
  }
  for (const d of parametres.localDishes ?? []) {
    catalog.push({
      categorie: "accompagnement",
      name: d.name,
      productId: d.id,
      unitPrice: d.unitPrice,
    });
  }
  for (const d of parametres.drinks ?? []) {
    if (d.salePrice == null) continue;
    catalog.push({
      categorie: "boisson",
      name: d.name,
      productId: d.id,
      unitPrice: d.salePrice,
    });
  }
  return catalog.sort((a, b) =>
    `${a.categorie}${a.name}`.localeCompare(`${b.categorie}${b.name}`, "fr"),
  );
}

function productLists(catalog) {
  return {
    Plats: catalog
      .filter((c) => c.categorie === "plat")
      .map((c) => ({ Produit: c.name })),
    Accompagnements: catalog
      .filter((c) => c.categorie === "accompagnement")
      .map((c) => ({ Produit: c.name })),
    Boissons: catalog
      .filter((c) => c.categorie === "boisson")
      .map((c) => ({ Produit: c.name })),
  };
}

async function loadFromDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return { catalog: [], ventes: [], byDay: new Map() };

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");
  const parametres = await db.collection("parametres").findOne({ _id: "parametres" });
  const catalog = buildCatalog(parametres ?? {});

  const grouped = await db
    .collection("ventes_log")
    .aggregate([
      {
        $match: {
          cancelledAt: null,
          kind: { $in: ["plat", "local", "boisson"] },
        },
      },
      {
        $group: {
          _id: {
            date: "$date",
            site: "$site",
            kind: "$kind",
            name: "$name",
          },
          qty: { $sum: "$qty" },
        },
      },
      { $sort: { "_id.date": 1 } },
    ])
    .toArray();

  const ventes = [];
  const byDay = new Map();

  for (const g of grouped) {
    const cat = kindToCategorie(g._id.kind);
    if (!cat) continue;
    const row = {
      Date: g._id.date,
      Site: g._id.site,
      Catégorie: cat,
      Produit: g._id.name,
      Quantité: g.qty,
    };
    ventes.push(row);

    const dayKey = `${g._id.date}|${g._id.site}`;
    if (!byDay.has(dayKey)) byDay.set(dayKey, new Map());
    byDay.get(dayKey).set(`${cat}|${g._id.name}`, g.qty);
  }

  await client.close();
  return { catalog, ventes, byDay };
}

async function main() {
  let catalog = [];
  let ventes = [];
  let byDay = new Map();

  if (FROM_DB) {
    try {
      ({ catalog, ventes, byDay } = await loadFromDb());
      console.log(
        `Données chargées : ${ventes.length} ligne(s) ventes · ${catalog.length} produit(s)`,
      );
    } catch (e) {
      console.warn("MongoDB:", e.message);
    }
  }

  if (!catalog.length) {
    catalog = buildCatalog({
      baseDishes: [
        { id: "base-ex", name: "CHOUKOUYA", unitPrice: 2500 },
      ],
      localDishes: [{ id: "local-ex", name: "FRITE", unitPrice: 500 }],
      drinks: [
        {
          id: "drink-ex",
          name: "COCA COLA",
          purchasePrice: 300,
          salePrice: 500,
          unitsPerCasier: 24,
        },
      ],
    });
  }

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    buildSheet(
      GUIDE,
      "King Fish — Ventes par jour",
      "Plats · accompagnements · boissons — Date · Site · Catégorie · Produit · Quantité",
    ),
    "Guide",
  );

  const lists = productLists(catalog);
  for (const [name, rows] of Object.entries(lists)) {
    XLSX.utils.book_append_sheet(
      wb,
      buildSheet(rows, name, "Liste de référence — ne pas modifier"),
      name.slice(0, 31),
    );
  }

  XLSX.utils.book_append_sheet(
    wb,
    buildSheet(
      buildVentesRows(ventes),
      "Ventes (tous les jours)",
      VENTES_FIELDS.map((f) => f.key).join(" · "),
    ),
    "Ventes",
  );

  const dayKeys = [...byDay.keys()].sort();
  for (const dayKey of dayKeys.slice(-62)) {
    const [date, site] = dayKey.split("|");
    const existing = byDay.get(dayKey);
    const rows = buildDaySheetRows(catalog, date, existing);
    const siteTag = site === "gbegamey" ? "G" : "Z";
    const sheetName = `J_${date}_${siteTag}`.slice(0, 31);
    XLSX.utils.book_append_sheet(
      wb,
      buildSheet(
        rows,
        `Ventes ${date} (${site})`,
        "Quantité vendue par produit — laisser vide si 0",
      ),
      sheetName,
    );
  }

  await mkdir(OUT_DIR, { recursive: true });
  XLSX.writeFile(wb, OUT_FILE);
  const rootCopy = path.join(ROOT, "KingFish-Ventes-Jour.xlsx");
  await copyFile(OUT_FILE, rootCopy);

  console.log(`Fichier généré : ${OUT_FILE}`);
  console.log(`Copie racine   : ${rootCopy}`);
  console.log(
    `Feuilles       : Guide, Plats, Accompagnements, Boissons, Ventes${dayKeys.length ? `, ${Math.min(dayKeys.length, 62)} feuille(s) jour` : ""}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
