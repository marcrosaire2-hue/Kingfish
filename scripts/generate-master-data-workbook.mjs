/**
 * Génère le classeur Excel technique (dictionnaire + migration).
 * Fichier ventes journalières : scripts/generate-saisie-gerant-workbook.mjs → KingFish-Ventes-Jour.xlsx
 *
 * Usage:
 *   node scripts/generate-master-data-workbook.mjs
 *   node --env-file=.env.local scripts/generate-master-data-workbook.mjs --from-db
 */
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx-js-style";
import { MongoClient } from "mongodb";
import {
  ENTITIES,
  TEMPLATE_EMPTY_ROWS,
  buildDictionary,
  buildIndexFeuilles,
  emptyRow,
  obligationRow,
  exampleRow,
} from "./master-data-schema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "exports");
const OUT_FILE = path.join(OUT_DIR, "KingFish-Master-Data.xlsx");
const FROM_DB = process.argv.includes("--from-db");

const BLEU = "004888";
const OR = "F0B018";
const GRIS_LIGNE = "F2F6FA";
const BORDURE = "D5E0EC";
const VERT_CLAIR = "E8F5E9";
const ROSE_CLAIR = "FFF3E0";

const REF = {
  UserRole: ["gerant", "comptable", "daf", "admin"],
  UserSite: ["zogbo", "gbegamey", "tous"],
  UserShift: ["jour", "nuit", "aucune"],
  VenteSite: ["zogbo", "gbegamey"],
  VenteKind: ["plat", "boisson", "local", "extra"],
  DayStatus: ["ouverte", "cloturee"],
  CaisseKey: ["centrale", "zogbo", "gbegamey"],
  CaisseStatut: ["ouverte", "fermee"],
  CaisseMouvementKind: ["depense", "recette", "versement-sortie", "versement-entree"],
  PosTicketStatut: ["valide", "annule"],
  SaleType: ["Sur place", "Rapido"],
  PerteMotif: ["gate", "casse", "test", "offert", "erreur", "autre"],
  PerteKind: ["plat", "local", "boisson", "matiere", "immobilisation", "libre"],
  ImmobilisationKind: ["actif", "emballage"],
  MigrationStatus: ["À faire", "En cours", "Validé", "Ignoré", "À CONFIRMER"],
};

const README_GERANT = [
  { Étape: "1", Action: "Lire cette feuille et Index_Feuilles" },
  { Étape: "2", Action: "Remplir les feuilles MD_* (catalogue, users, POS) — lignes vides en bas" },
  { Étape: "3", Action: "Remplir TX_* seulement si migration / reprise de données" },
  { Étape: "4", Action: "Ne pas saisir les colonnes marquées (calculé) ou NON dans le dictionnaire" },
  { Étape: "5", Action: "Statut_migration : passer à Validé quand la ligne est prête" },
  { Étape: "6", Action: "Contrôler avec Validation_QC avant import" },
  { Étape: "7", Action: "Sauvegarder MongoDB avant tout import (npm run sauvegarde)" },
  { Étape: "—", Action: "Import : scripts Node ou À CONFIRMER importeur unifié" },
];

const VALIDATION_QC = [
  { Contrôle: "ID plat unique", Feuille: "MD_Plats_Base", Gravité: "Bloquant" },
  { Contrôle: "productId existe dans catalogue", Feuille: "TX_*", Gravité: "Bloquant" },
  { Contrôle: "Date YYYY-MM-DD", Feuille: "Toutes TX_*", Gravité: "Bloquant" },
  { Contrôle: "Enums (role, site, kind…)", Feuille: "Reference_Data", Gravité: "Bloquant" },
  { Contrôle: "Réduction ≤ montantBrut", Feuille: "TX_POS_Tickets", Gravité: "Bloquant" },
  { Contrôle: "Champs Calculé non saisis", Feuille: "Toutes", Gravité: "Avertissement" },
  { Contrôle: "Lignes Statut_migration = Validé", Feuille: "Toutes", Gravité: "Info" },
];

const MIGRATION_MAPPING = [
  {
    "Plateforme MongoDB": "parametres",
    "Feuille Excel": "MD_Plats_Base, MD_Boissons, …",
    Règle: "Éclater document unique en tables master",
    Statut: "À faire",
  },
  {
    "Plateforme MongoDB": "ventes_log",
    "Feuille Excel": "TX_Ventes_Log",
    Règle: "Préserver prix figés ; resync sold après import",
    Statut: "Préservé",
  },
  {
    "Plateforme MongoDB": "users.passwordHash",
    "Feuille Excel": "—",
    Règle: "À CONFIRMER — réinitialisation mots de passe",
    Statut: "À CONFIRMER",
  },
];

function referenceRows() {
  const rows = [];
  for (const [cat, values] of Object.entries(REF)) {
    for (const v of values) {
      rows.push({ Catégorie: cat, Code: v, Libellé: v });
    }
  }
  return rows;
}

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
    const isHint =
      String(row[keys[0]] || "").startsWith("→");
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
    wch: Math.min(44, Math.max(10, String(k).length + 2)),
  }));
  ws["!rows"] = [{ hpt: 24 }, { hpt: 36 }];
  ws["!freeze"] = { xSplit: 0, ySplit: 3 };
  return ws;
}

/** Données existantes MongoDB → lignes par entité */
function mapDbRows(entity, db) {
  const p = db?.parametres;
  const pc = db?.posConfig;
  const meta = () => ({ Statut_migration: "Validé" });

  switch (entity.entity) {
    case "PlatBase":
      return (p?.baseDishes ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        unitPrice: r.unitPrice,
        costPrice: r.costPrice ?? "",
        alertThreshold: r.alertThreshold ?? 0,
        ...meta(),
      }));
    case "Boisson":
      return (p?.drinks ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        purchasePrice: r.purchasePrice,
        salePrice: r.salePrice ?? "",
        unitsPerCasier: r.unitsPerCasier ?? 24,
        alertThreshold: r.alertThreshold ?? 0,
        ...meta(),
      }));
    case "PlatLocal":
      return (p?.localDishes ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        unitPrice: r.unitPrice,
        costPrice: r.costPrice ?? "",
        alertThreshold: r.alertThreshold ?? 0,
        ...meta(),
      }));
    case "MatierePremiere":
      return (p?.rawMaterials ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        unit: r.unit,
        purchasePrice: r.purchasePrice,
        threshold: r.threshold,
        stockBlocking: r.stockBlocking ? "oui" : "non",
        ...meta(),
      }));
    case "Recette": {
      const out = [];
      for (const rec of p?.recipes ?? []) {
        for (const l of rec.lines ?? []) {
          out.push({
            productId: rec.productId,
            rawMaterialId: l.rawMaterialId,
            qty: l.qty,
            ...meta(),
          });
        }
      }
      return out;
    }
    case "User":
      return (db?.users ?? []).map((u) => ({
        id: String(u._id),
        username: u.username,
        name: u.name,
        role: u.role,
        site: u.site,
        shift: u.shift ?? "aucune",
        active: u.active !== false ? "oui" : "non",
        motDePasse: "NON EXPORTÉ",
        ...meta(),
      }));
    case "PosPaymentMethod":
      return (pc?.paymentMethods ?? []).map((r) => ({
        id: r.id,
        libelle: r.libelle,
        ...meta(),
      }));
    case "PosTable":
      return (pc?.tables ?? []).map((r) => ({
        id: r.id,
        reference: r.reference,
        emplacement: r.emplacement,
        ...meta(),
      }));
    case "PosServeur":
      return (pc?.serveurs ?? []).map((r) => ({
        id: r.id,
        nom: r.nom,
        ...meta(),
      }));
    case "Fournisseur":
      return (pc?.fournisseurs ?? []).map((r) => ({
        id: r.id,
        nom: r.nom,
        contact: r.contact ?? "",
        ...meta(),
      }));
    case "PosCompany":
      return pc?.company
        ? [
            {
              nom: pc.company.nom ?? "",
              contacts: pc.company.contacts ?? "",
              adresse: pc.company.adresse ?? "",
              activites: pc.company.activites ?? "",
              Statut_migration: "Validé",
            },
          ]
        : [];
    default:
      return [];
  }
}

function buildEntityRows(entity, db) {
  const existing = FROM_DB && db ? mapDbRows(entity, db) : [];
  const rows = [];
  rows.push(obligationRow(entity));
  rows.push(exampleRow(entity));
  for (const r of existing) rows.push(r);
  for (let i = 0; i < TEMPLATE_EMPTY_ROWS; i++) {
    rows.push({ ...emptyRow(entity), Statut_migration: "À faire" });
  }
  return rows;
}

async function loadFromDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");
  const [parametres, users, posConfig] = await Promise.all([
    db.collection("parametres").findOne({ _id: "parametres" }),
    db.collection("users").find({}).toArray(),
    db.collection("pos_config").findOne({ _id: "pos_config" }),
  ]);
  await client.close();
  return { parametres, users, posConfig };
}

async function main() {
  let db = null;
  if (FROM_DB) {
    try {
      db = await loadFromDb();
      console.log("Données MongoDB chargées.");
    } catch (e) {
      console.warn("MongoDB:", e.message);
    }
  }

  const wb = XLSX.utils.book_new();

  const metaSheets = [
    {
      name: "Guide_Gerant",
      rows: README_GERANT,
      title: "Guide de saisie — Gérant",
      subtitle:
        "Remplissez les feuilles MD_* et TX_* · 30 lignes vides par table · Voir Data_Dictionary",
    },
    {
      name: "Index_Feuilles",
      rows: buildIndexFeuilles(ENTITIES),
      title: "Index des feuilles à remplir",
      subtitle: `${ENTITIES.length} tables · 1 feuille = 1 entité du dictionnaire`,
    },
    {
      name: "Data_Dictionary",
      rows: buildDictionary(ENTITIES),
      title: "Dictionnaire complet",
      subtitle: `${buildDictionary(ENTITIES).length} champs · colonne « À remplir gérant »`,
    },
    {
      name: "Reference_Data",
      rows: referenceRows(),
      title: "Valeurs de référence (listes déroulantes)",
    },
    {
      name: "Validation_QC",
      rows: VALIDATION_QC,
      title: "Contrôles qualité",
    },
    {
      name: "Migration_Mapping",
      rows: MIGRATION_MAPPING,
      title: "Cartographie migration MongoDB ↔ Excel",
    },
    {
      name: "Change_Log",
      rows: [
        {
          Date: new Date().toISOString().slice(0, 10),
          Auteur: "",
          Feuille: "",
          Ligne: "",
          Action: "",
          Notes: "",
        },
      ],
      title: "Journal des modifications",
    },
  ];

  for (const sh of metaSheets) {
    XLSX.utils.book_append_sheet(
      wb,
      buildSheet(sh.rows, sh.title, sh.subtitle),
      sh.name.slice(0, 31),
    );
  }

  for (const entity of ENTITIES) {
    const rows = buildEntityRows(entity, db);
    XLSX.utils.book_append_sheet(
      wb,
      buildSheet(
        rows,
        entity.title,
        `${entity.category} · ${entity.collection} · ${entity.instruction}`,
      ),
      entity.sheet.slice(0, 31),
    );
  }

  await mkdir(OUT_DIR, { recursive: true });
  XLSX.writeFile(wb, OUT_FILE);

  const specPath = path.join(OUT_DIR, "KingFish-Master-Data-SPEC.md");
  const rootXlsx = path.join(ROOT, "KingFish-Master-Data.xlsx");
  const rootSpec = path.join(ROOT, "KingFish-Master-Data-SPEC.md");
  await writeFile(
    specPath,
    `# King Fish — Classeur saisie gérant

Généré le ${new Date().toISOString()}

- **${ENTITIES.length} feuilles de saisie** (1 par entité du dictionnaire)
- **${buildDictionary(ENTITIES).length} champs** documentés
- **${TEMPLATE_EMPTY_ROWS} lignes vides** par feuille pour nouvelles entrées
- Feuilles MD_* = catalogue · TX_* = transactions / stocks journaliers

Regénérer technique : \`node --env-file=.env.local scripts/generate-master-data-workbook.mjs --from-db\`
Regénérer saisie gérant : \`node --env-file=.env.local scripts/generate-saisie-gerant-workbook.mjs --from-db\`
`,
    "utf8",
  );
  await copyFile(OUT_FILE, rootXlsx);
  await copyFile(specPath, rootSpec);

  console.log(`Classeur technique : ${OUT_FILE}`);
  console.log(`Copie racine         : ${rootXlsx}`);
  console.log(
    `Feuilles             : ${metaSheets.length + ENTITIES.length} · dictionnaire : ${buildDictionary(ENTITIES).length} champs`,
  );
  console.log(
    `Saisie gérant        : node --env-file=.env.local scripts/generate-saisie-gerant-workbook.mjs --from-db`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
