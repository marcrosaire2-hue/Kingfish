/**
 * Crée les 20 comptes gérant Gbégamey (equipe13 … equipe32)
 * et exporte les identifiants dans un Excel à la racine.
 *
 * 7 jours × 3 créneaux − 1 (nuit mardi 00h–08h fermée).
 * Actif dès 2026-09-01. Met aussi à jour equipe7–12 Zogbo en shift « soir ».
 *
 * Usage :
 *   node --env-file=.env.local scripts/creer-20-comptes-gbegamey.mjs --yes
 */
import { randomBytes } from "node:crypto";
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
const OUT_FILE = path.join(ROOT, "KingFish-Comptes-Gbegamey-20.xlsx");

const JOURS = [
  { slug: "lundi", label: "Lundi" },
  { slug: "mardi", label: "Mardi" },
  { slug: "mercredi", label: "Mercredi" },
  { slug: "jeudi", label: "Jeudi" },
  { slug: "vendredi", label: "Vendredi" },
  { slug: "samedi", label: "Samedi" },
  { slug: "dimanche", label: "Dimanche" },
];

function genPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  let out = "Gb";
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

const COMPTES = [];
let n = 13;

// Nuit 00h–08h — sauf mardi
for (const j of JOURS.filter((x) => x.slug !== "mardi")) {
  COMPTES.push({
    numero: n,
    periode: "Nuit",
    jour: j.label,
    horaire: "00h00–08h00",
    username: `equipe${n}`,
    name: `Équipe ${n}`,
    shift: "nuit",
    role: "gerant",
    site: "gbegamey",
    password: genPassword(),
  });
  n += 1;
}
// Matin 08h–16h — 7 jours
for (const j of JOURS) {
  COMPTES.push({
    numero: n,
    periode: "Matin",
    jour: j.label,
    horaire: "08h00–16h00",
    username: `equipe${n}`,
    name: `Équipe ${n}`,
    shift: "jour",
    role: "gerant",
    site: "gbegamey",
    password: genPassword(),
  });
  n += 1;
}
// Soir 16h–00h — 7 jours
for (const j of JOURS) {
  COMPTES.push({
    numero: n,
    periode: "Soir",
    jour: j.label,
    horaire: "16h00–00h00",
    username: `equipe${n}`,
    name: `Équipe ${n}`,
    shift: "soir",
    role: "gerant",
    site: "gbegamey",
    password: genPassword(),
  });
  n += 1;
}

if (COMPTES.length !== 20) {
  console.error(`Attendu 20 comptes, obtenu ${COMPTES.length}`);
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
const col = db.collection("users");
const now = new Date().toISOString();

console.log("Création / mise à jour des 20 comptes Gbégamey (equipe13 … equipe32)…");
console.log("  Fermeture : mardi 00h00–08h00 uniquement");
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
    console.log(`mis à jour : ${c.username} · ${c.periode} ${c.jour}`);
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
    console.log(`créé      : ${c.username} · ${c.periode} ${c.jour}`);
  }
}

// Zogbo soir (equipe7–12) : shift nuit → soir (3e créneau formalisé).
const zogboSoir = await col.updateMany(
  {
    username: { $in: ["equipe7", "equipe8", "equipe9", "equipe10", "equipe11", "equipe12"] },
  },
  {
    $set: { shift: "soir", updatedAt: now },
    $inc: { tokenVersion: 1 },
  },
);
console.log(`Zogbo equipe7–12 → shift soir (${zogboSoir.modifiedCount} compte(s))`);

await client.close();

const header = [
  "N° compte",
  "Identifiant",
  "Mot de passe",
  "Nom affiché",
  "Période",
  "Jour",
  "Horaire",
  "Rôle",
  "Site",
  "Équipe (app)",
  "Note",
];

const rows = COMPTES.map((c) => [
  c.numero,
  c.username,
  c.password,
  c.name,
  c.periode,
  c.jour,
  c.horaire,
  c.role,
  c.site,
  c.shift,
  c.periode === "Nuit" && c.jour === "Mardi"
    ? "FERMÉ"
    : "Actif dès 2026-09-01 · mardi nuit fermé",
]);

const noteRows = [
  [],
  ["Organisation Gbégamey"],
  ["Identifiants", "equipe13 … equipe32"],
  ["Nuit", "00h00–08h00 · 6 comptes (pas de mardi)"],
  ["Matin", "08h00–16h00 · 7 comptes"],
  ["Soir", "16h00–00h00 · 7 comptes"],
  ["Fermeture", "Mardi 00h00–08h00"],
  ["Total", "20 comptes gérant"],
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
  { wch: 12 },
  { wch: 14 },
  { wch: 12 },
  { wch: 10 },
  { wch: 12 },
  { wch: 14 },
  { wch: 10 },
  { wch: 12 },
  { wch: 12 },
  { wch: 40 },
];

const headerStyle = {
  fill: { fgColor: { rgb: "1B5E20" } },
  font: { bold: true, color: { rgb: "FFFFFF" } },
  alignment: { horizontal: "center" },
};
for (let c = 0; c < header.length; c++) {
  const addr = XLSX.utils.encode_cell({ r: 0, c });
  if (ws[addr]) ws[addr].s = headerStyle;
}

const fills = {
  Nuit: { fill: { fgColor: { rgb: "E3F2FD" } } },
  Matin: { fill: { fgColor: { rgb: "E8F5E9" } } },
  Soir: { fill: { fgColor: { rgb: "FFF3E0" } } },
};
for (let r = 1; r <= 20; r++) {
  const periode = rows[r - 1][4];
  const fill = fills[periode] || {};
  for (let c = 0; c < header.length; c++) {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (ws[addr]) ws[addr].s = fill;
  }
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Comptes Gbégamey");
XLSX.writeFile(wb, OUT_FILE);

console.log("");
console.log(`Excel écrit : ${OUT_FILE}`);
console.log("20 comptes prêts (equipe13 … equipe32).");
