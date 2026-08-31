/**
 * Réorganisation définitive Gbégamey :
 * - 1 nuit + 7 matin + 5 soir = 13 comptes (equipe13 … equipe25)
 * - Suppression définitive des surplus (equipe26 … equipe32 et anciens doublons)
 * - Excel à la racine
 *
 * Usage :
 *   node --env-file=.env.local scripts/reorg-gbegamey-equipes.mjs --yes
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import XLSX from "xlsx-js-style";

const args = new Set(process.argv.slice(2));
if (!args.has("--yes")) {
  console.error("Refus : passez --yes pour appliquer la réorganisation.");
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
const OUT_FILE = path.join(ROOT, "KingFish-Comptes-Gbegamey-13.xlsx");

function genPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  let out = "Gb";
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/** Définition alignée sur src/lib/gbegamey-planning-comptes.ts */
const COMPTES = [
  {
    numero: 13,
    username: "equipe13",
    name: "Équipe Nuit",
    periode: "Nuit",
    equipe: "Nuit",
    jours: "Lun, Mer, Jeu, Ven, Sam, Dim (pas mardi)",
    horaire: "00h00–08h00",
    shift: "nuit",
  },
  {
    numero: 14,
    username: "equipe14",
    name: "Équipe Matin Lundi",
    periode: "Matin",
    equipe: "Lundi",
    jours: "Vendredi",
    horaire: "08h00–16h00",
    shift: "jour",
  },
  {
    numero: 15,
    username: "equipe15",
    name: "Équipe Matin Mardi",
    periode: "Matin",
    equipe: "Mardi",
    jours: "Jeudi",
    horaire: "08h00–16h00",
    shift: "jour",
  },
  {
    numero: 16,
    username: "equipe16",
    name: "Équipe Matin Mercredi",
    periode: "Matin",
    equipe: "Mercredi",
    jours: "Samedi",
    horaire: "08h00–16h00",
    shift: "jour",
  },
  {
    numero: 17,
    username: "equipe17",
    name: "Équipe Matin Jeudi",
    periode: "Matin",
    equipe: "Jeudi",
    jours: "Mardi",
    horaire: "08h00–16h00",
    shift: "jour",
  },
  {
    numero: 18,
    username: "equipe18",
    name: "Équipe Matin Vendredi",
    periode: "Matin",
    equipe: "Vendredi",
    jours: "Lundi",
    horaire: "08h00–16h00",
    shift: "jour",
  },
  {
    numero: 19,
    username: "equipe19",
    name: "Équipe Matin Samedi",
    periode: "Matin",
    equipe: "Samedi",
    jours: "Dimanche",
    horaire: "08h00–16h00",
    shift: "jour",
  },
  {
    numero: 20,
    username: "equipe20",
    name: "Équipe Matin Dimanche",
    periode: "Matin",
    equipe: "Dimanche",
    jours: "Mercredi",
    horaire: "08h00–16h00",
    shift: "jour",
  },
  {
    numero: 21,
    username: "equipe21",
    name: "Équipe Soir Lundi",
    periode: "Soir",
    equipe: "Lundi",
    jours: "Lundi + Mercredi",
    horaire: "16h00–00h00",
    shift: "soir",
  },
  {
    numero: 22,
    username: "equipe22",
    name: "Équipe Soir Mardi",
    periode: "Soir",
    equipe: "Mardi",
    jours: "Mardi + Samedi",
    horaire: "16h00–00h00",
    shift: "soir",
  },
  {
    numero: 23,
    username: "equipe23",
    name: "Équipe Soir Jeudi",
    periode: "Soir",
    equipe: "Jeudi",
    jours: "Jeudi",
    horaire: "16h00–00h00",
    shift: "soir",
  },
  {
    numero: 24,
    username: "equipe24",
    name: "Équipe Soir Vendredi",
    periode: "Soir",
    equipe: "Vendredi",
    jours: "Vendredi",
    horaire: "16h00–00h00",
    shift: "soir",
  },
  {
    numero: 25,
    username: "equipe25",
    name: "Équipe Soir Dimanche",
    periode: "Soir",
    equipe: "Dimanche",
    jours: "Dimanche",
    horaire: "16h00–00h00",
    shift: "soir",
  },
].map((c) => ({ ...c, password: genPassword(), role: "gerant", site: "gbegamey" }));

const KEEP = new Set(COMPTES.map((c) => c.username));

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
const col = db.collection("users");
const now = new Date().toISOString();

console.log("Réorganisation Gbégamey — 13 comptes nécessaires…");

// 1) Supprimer définitivement tout compte equipe13–32 hors liste utile
//    (et tout ancien login zogbo.* gbegamey s’il en restait).
const surplus = await col
  .find({
    $or: [
      { username: { $regex: /^equipe(1[3-9]|2[0-9]|3[0-2])$/ } },
      { username: { $regex: /^zogbo\.(matin|soir)\./ }, site: "gbegamey" },
    ],
  })
  .toArray();

let deleted = 0;
for (const u of surplus) {
  if (KEEP.has(u.username)) continue;
  await col.deleteOne({ _id: u._id });
  deleted += 1;
  console.log(`supprimé  : ${u.username}`);
}
console.log(`→ ${deleted} compte(s) surplus effacé(s)`);

// 2) Créer / mettre à jour les 13 comptes
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
    console.log(`mis à jour : ${c.username} · ${c.name}`);
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
    console.log(`créé      : ${c.username} · ${c.name}`);
  }
}

// Sécurité : aucune session / présence pour les comptes effacés
await db.collection("connexion_sessions").deleteMany({
  username: { $regex: /^equipe(2[6-9]|3[0-2])$/ },
});

await client.close();

const header = [
  "N°",
  "Identifiant",
  "Mot de passe",
  "Nom",
  "Période",
  "Équipe",
  "Jours de service",
  "Horaire",
  "Site",
];

const rows = COMPTES.map((c) => [
  c.numero,
  c.username,
  c.password,
  c.name,
  c.periode,
  c.equipe,
  c.jours,
  c.horaire,
  c.site,
]);

const notes = [
  [],
  ["Organisation définitive Gbégamey"],
  ["Nuit", "1 compte · 00h–08h · mardi fermé"],
  ["Matin", "7 comptes · rotation croisée"],
  ["Soir", "5 comptes · lun, mar, jeu, ven, dim"],
  ["Total", "13 comptes (equipe13–equipe25)"],
  ["Supprimés", "equipe26–equipe32 et anciens doublons"],
];

const ws = XLSX.utils.aoa_to_sheet([header, ...rows, ...notes]);
ws["!cols"] = [
  { wch: 6 },
  { wch: 12 },
  { wch: 14 },
  { wch: 22 },
  { wch: 8 },
  { wch: 10 },
  { wch: 28 },
  { wch: 14 },
  { wch: 10 },
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Gbégamey 13");
XLSX.writeFile(wb, OUT_FILE);

// Retirer l’ancien fichier 20 comptes s’il est encore là
try {
  const { unlinkSync } = await import("node:fs");
  unlinkSync(path.join(ROOT, "KingFish-Comptes-Gbegamey-20.xlsx"));
  console.log("Ancien Excel 20 comptes supprimé.");
} catch {
  /* absent */
}

console.log("");
console.log(`Excel : ${OUT_FILE}`);
console.log("Réorganisation terminée.");
