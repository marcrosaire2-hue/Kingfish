/**
 * Crée les 12 comptes gérant Zogbo (6 matin + 6 soir, mar–dim)
 * et exporte les identifiants dans un Excel.
 *
 * Planning appliqué dans l’app à partir du 2026-09-01 (fermeture lundi).
 *
 * Usage :
 *   node --env-file=.env.local scripts/creer-12-comptes-zogbo.mjs --yes
 */
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import XLSX from "xlsx-js-style";

const args = new Set(process.argv.slice(2));
if (!args.has("--yes")) {
  console.error("Refus : passez --yes pour créer / mettre à jour les comptes.");
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "gestion_restaurant";
if (!uri) {
  console.error("MONGODB_URI manquant.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "exports");
const OUT_FILE = path.join(OUT_DIR, "KingFish-Comptes-Zogbo-12.xlsx");

const JOURS = [
  { slug: "mardi", label: "Mardi" },
  { slug: "mercredi", label: "Mercredi" },
  { slug: "jeudi", label: "Jeudi" },
  { slug: "vendredi", label: "Vendredi" },
  { slug: "samedi", label: "Samedi" },
  { slug: "dimanche", label: "Dimanche" },
];

/** Génère un mot de passe lisible (8–10 car.). */
function genPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  let out = "Zg";
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

const COMPTES = [];
let n = 1;
for (const j of JOURS) {
  COMPTES.push({
    numero: n++,
    periode: "Matin",
    jour: j.label,
    horaire: "08h00–16h00",
    username: `zogbo.matin.${j.slug}`,
    name: `Zogbo Matin ${j.label}`,
    shift: "jour",
    role: "gerant",
    site: "zogbo",
    password: genPassword(),
  });
}
for (const j of JOURS) {
  COMPTES.push({
    numero: n++,
    periode: "Soir",
    jour: j.label,
    horaire: "16h00–00h00",
    username: `zogbo.soir.${j.slug}`,
    name: `Zogbo Soir ${j.label}`,
    shift: "nuit",
    role: "gerant",
    site: "zogbo",
    password: genPassword(),
  });
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
const col = db.collection("users");
const now = new Date().toISOString();

console.log("Création / mise à jour des 12 comptes Zogbo…");
console.log("  Fermeture lundi · ventes mardi → dimanche");
console.log("");

for (const c of COMPTES) {
  const hash = await bcrypt.hash(c.password, 12);
  const existing = await col.findOne({ username: c.username });
  if (existing) {
    await col.updateOne(
      { _id: existing._id },
      {
        $set: {
          name: c.name,
          role: c.role,
          site: c.site,
          shift: c.shift,
          active: true,
          passwordHash: hash,
          updatedAt: now,
          tokenVersion: (existing.tokenVersion ?? 1) + 1,
        },
      },
    );
    console.log(`mis à jour : ${c.username}`);
  } else {
    await col.insertOne({
      _id: new ObjectId(),
      username: c.username,
      name: c.name,
      passwordHash: hash,
      role: c.role,
      site: c.site,
      shift: c.shift,
      active: true,
      tokenVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`créé      : ${c.username}`);
  }
}

await client.close();

const header = [
  "N° compte",
  "Période",
  "Jour",
  "Horaire",
  "Identifiant",
  "Mot de passe",
  "Nom affiché",
  "Rôle",
  "Site",
  "Équipe (app)",
  "Note",
];

const rows = COMPTES.map((c) => [
  c.numero,
  c.periode,
  c.jour,
  c.horaire,
  c.username,
  c.password,
  c.name,
  c.role,
  c.site,
  c.shift === "jour" ? "jour (matin)" : "nuit (soir)",
  "Ne pas utiliser le lundi (Zogbo fermé)",
]);

const noteRows = [
  [],
  ["Organisation"],
  ["Site", "Zogbo"],
  ["Ouverture", "Mardi → Dimanche"],
  ["Fermeture", "Lundi (aucun compte prévu)"],
  ["Matin", "08h00–16h00 · 6 comptes"],
  ["Soir", "16h00–00h00 · 6 comptes"],
  ["Total", "12 comptes gérant"],
  [],
  [
    "Attention",
    "Fichier confidentiel — changez les mots de passe après distribution.",
  ],
];

const aoa = [header, ...rows, ...noteRows];
const ws = XLSX.utils.aoa_to_sheet(aoa);
ws["!cols"] = [
  { wch: 10 },
  { wch: 10 },
  { wch: 12 },
  { wch: 14 },
  { wch: 22 },
  { wch: 14 },
  { wch: 22 },
  { wch: 10 },
  { wch: 10 },
  { wch: 14 },
  { wch: 40 },
];

const headerStyle = {
  fill: { fgColor: { rgb: "004888" } },
  font: { bold: true, color: { rgb: "FFFFFF" } },
  alignment: { horizontal: "center" },
};
for (let c = 0; c < header.length; c++) {
  const addr = XLSX.utils.encode_cell({ r: 0, c });
  if (ws[addr]) ws[addr].s = headerStyle;
}

const matinFill = { fill: { fgColor: { rgb: "E8F5E9" } } };
const soirFill = { fill: { fgColor: { rgb: "FFF3E0" } } };
for (let r = 1; r <= 12; r++) {
  const fill = r <= 6 ? matinFill : soirFill;
  for (let c = 0; c < header.length; c++) {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (ws[addr]) ws[addr].s = fill;
  }
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Comptes Zogbo");

await mkdir(OUT_DIR, { recursive: true });
XLSX.writeFile(wb, OUT_FILE);

console.log("");
console.log(`Excel écrit : ${OUT_FILE}`);
console.log("12 comptes prêts (6 matin + 6 soir).");
