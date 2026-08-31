/**
 * Crée / met à jour les 12 comptes gérant Zogbo (equipe1 … equipe12)
 * et exporte les identifiants dans un Excel.
 *
 * Planning appliqué dans l’app à partir du 2026-09-01 (fermeture lundi).
 * Désactive les anciens identifiants zogbo.matin.* / zogbo.soir.*.
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
    numero: n,
    periode: "Matin",
    jour: j.label,
    horaire: "08h00–16h00",
    username: `equipe${n}`,
    name: `Équipe ${n}`,
    shift: "jour",
    role: "gerant",
    site: "zogbo",
    password: genPassword(),
    legacyUsername: `zogbo.matin.${j.slug}`,
  });
  n += 1;
}
for (const j of JOURS) {
  COMPTES.push({
    numero: n,
    periode: "Soir",
    jour: j.label,
    horaire: "16h00–00h00",
    username: `equipe${n}`,
    name: `Équipe ${n}`,
    shift: "nuit",
    role: "gerant",
    site: "zogbo",
    password: genPassword(),
    legacyUsername: `zogbo.soir.${j.slug}`,
  });
  n += 1;
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
const col = db.collection("users");
const now = new Date().toISOString();

console.log("Création / mise à jour des 12 comptes (equipe1 … equipe12)…");
console.log("  Fermeture lundi · ventes mardi → dimanche");
console.log("");

for (const c of COMPTES) {
  const hash = await bcrypt.hash(c.password, 12);
  const byNew = await col.findOne({ username: c.username });
  const byLegacy = await col.findOne({ username: c.legacyUsername });

  if (byNew) {
    await col.updateOne(
      { _id: byNew._id },
      {
        $set: {
          name: c.name,
          role: c.role,
          site: c.site,
          shift: c.shift,
          active: true,
          passwordHash: hash,
          updatedAt: now,
          tokenVersion: (byNew.tokenVersion ?? 1) + 1,
        },
      },
    );
    console.log(`mis à jour : ${c.username} (${c.name})`);
  } else if (byLegacy) {
    await col.updateOne(
      { _id: byLegacy._id },
      {
        $set: {
          username: c.username,
          name: c.name,
          role: c.role,
          site: c.site,
          shift: c.shift,
          active: true,
          passwordHash: hash,
          updatedAt: now,
          tokenVersion: (byLegacy.tokenVersion ?? 1) + 1,
        },
      },
    );
    console.log(`renommé   : ${c.legacyUsername} → ${c.username}`);
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
    console.log(`créé      : ${c.username} (${c.name})`);
  }

  // Au cas où l’ancien login existe encore à part.
  if (byLegacy && byNew && String(byLegacy._id) !== String(byNew._id)) {
    await col.updateOne(
      { _id: byLegacy._id },
      {
        $set: {
          active: false,
          updatedAt: now,
          tokenVersion: (byLegacy.tokenVersion ?? 1) + 1,
        },
      },
    );
    console.log(`désactivé : ${c.legacyUsername}`);
  }
}

const leftover = await col.updateMany(
  {
    username: { $regex: /^zogbo\.(matin|soir)\./ },
    active: true,
  },
  {
    $set: {
      active: false,
      updatedAt: now,
    },
    $inc: { tokenVersion: 1 },
  },
);
if (leftover.modifiedCount) {
  console.log(`désactivé ${leftover.modifiedCount} ancien(s) login zogbo.*`);
}

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
  c.shift === "jour" ? "jour (matin)" : "nuit (soir)",
  "Ne pas utiliser le lundi (Zogbo fermé) · actif dès 2026-09-01",
]);

const noteRows = [
  [],
  ["Organisation"],
  ["Identifiants", "equipe1 … equipe12"],
  ["Site", "Zogbo"],
  ["Ouverture", "Mardi → Dimanche"],
  ["Fermeture", "Lundi (aucun compte prévu)"],
  ["Matin", "Équipe 1–6 · 08h00–16h00"],
  ["Soir", "Équipe 7–12 · 16h00–00h00"],
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
  { wch: 12 },
  { wch: 14 },
  { wch: 12 },
  { wch: 10 },
  { wch: 12 },
  { wch: 14 },
  { wch: 10 },
  { wch: 10 },
  { wch: 14 },
  { wch: 48 },
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
console.log("12 comptes prêts (equipe1 … equipe12).");
