/**
 * Décompose les lignes « repas » (ex-combos, extras) en plats + accompagnements.
 * Sources : carnet 08–10/08 uniquement pour les sorties de stock.
 * L'inventaire du 07/08 sert de stock initial au 08/08 — les ventes du 7 ne
 * sont pas déduites (journée d'inventaire).
 *
 * Usage: node scripts/decompose-repas-zogbo.mjs
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));

/** Plats standards — liste provisoire en attendant validation utilisateur. */
const PLATS = [
  { keys: ["attasi", "atassi"], name: "Attasi" },
  { keys: ["brochette"], name: "Brochette de poisson" },
  { keys: ["choucouya", "choukouya"], name: "Choucouya" },
  { keys: ["friture"], name: "Friture" },
  { keys: ["chawarma", "chawarma"], name: "Poisson Chawarma" },
  { keys: ["poisson pane", "poisson pané"], name: "Poisson pané" },
  { keys: ["sauce arachide", "sauce d arachide"], name: "Sauce arachide" },
  { keys: ["sauce graine"], name: "Sauce graine" },
  { keys: ["sauce legume", "sauce légume"], name: "Sauce légume" },
  { keys: ["sauce monyo", "monyo"], name: "Sauce Monyo" },
  { keys: ["sauce tchayo", "sauce tchiayo", "tchayo"], name: "Sauce Tchayo" },
  { keys: ["sauce tomate"], name: "Sauce tomate" },
  {
    keys: ["sauce poisson frais", "poisson frais"],
    name: "Sauce poisson frais",
    ambiguous: "Pas au catalogue — probable Sauce Monyo au poisson fumé ?",
  },
  { keys: ["portion seule"], name: null, skip: true },
  { keys: ["guinness"], name: null, skip: true },
  { keys: ["oeuf", "œuf"], name: "Œuf", isExtra: true },
];

/** Accompagnements — liste provisoire (ex localDishes). */
const ACCOMPAGNEMENTS = [
  { keys: ["riz"], name: "Riz" },
  { keys: ["telibo"], name: "Telibo" },
  { keys: ["pate de mais", "pâte de maïs", "pate de maïs"], name: "Pâte de Maïs" },
  { keys: ["pate noire", "pâte noire"], name: "Pate noire" },
  { keys: ["piron blanc"], name: "Piron blanc" },
  { keys: ["piron rouge"], name: "Piron rouge" },
  { keys: ["piron"], name: "Piron", ambiguous: "Blanc ou rouge non précisé" },
  { keys: ["placali"], name: "Placali" },
  { keys: ["frites"], name: "Frites" },
  { keys: ["spaghetti"], name: "Spaghetti" },
  { keys: ["legume saute", "légume sauté"], name: "Légume sauté" },
  { keys: ["wassa wassa"], name: "Wassa Wassa" },
  {
    keys: ["accompagnement"],
    name: "Accompagnement (non précisé)",
    ambiguous: "Type d'accompagnement inconnu",
  },
];

function norm(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchCatalog(part, catalog) {
  const n = norm(part);
  for (const item of catalog) {
    if (item.skip) continue;
    for (const k of item.keys) {
      if (n === k || n.includes(k) || k.includes(n)) return item;
    }
  }
  return null;
}

function decomposeMealLine(rawName, qty, meta = {}) {
  const parts = rawName.split(/\s*\+\s*/).map((p) => p.trim()).filter(Boolean);
  const plats = {};
  const accs = {};
  const unknown = [];
  const flags = [];

  if (parts.length === 1) {
    const hit = matchCatalog(parts[0], PLATS);
    if (hit?.name) {
      plats[hit.name] = (plats[hit.name] ?? 0) + qty;
      if (hit.ambiguous) flags.push({ part: parts[0], note: hit.ambiguous });
    } else if (parts[0].toLowerCase().includes("portion seule")) {
      const inner = parts[0].replace(/\(.*\)/i, "").trim();
      const dish = matchCatalog(inner, PLATS);
      if (dish?.name) plats[dish.name] = (plats[dish.name] ?? 0) + qty;
    } else {
      unknown.push(parts[0]);
    }
  } else {
    for (const part of parts) {
      const asPlat = matchCatalog(part, PLATS);
      const asAcc = matchCatalog(part, ACCOMPAGNEMENTS);
      if (asPlat?.name && !asPlat.isExtra) {
        plats[asPlat.name] = (plats[asPlat.name] ?? 0) + qty;
        if (asPlat.ambiguous) flags.push({ part, note: asPlat.ambiguous });
      } else if (asAcc?.name) {
        accs[asAcc.name] = (accs[asAcc.name] ?? 0) + qty;
        if (asAcc.ambiguous) flags.push({ part, note: asAcc.ambiguous });
      } else if (asPlat?.isExtra) {
        plats[asPlat.name] = (plats[asPlat.name] ?? 0) + qty;
      } else {
        unknown.push(part);
      }
    }
  }

  return { rawName, qty, ...meta, plats, accs, unknown, flags };
}

/** Repas transcrits — inventaire 07/08 (ex-combos). */
const INV_0708 = [
  { date: "2026-08-07", name: "Sauce tomate + riz", qty: 1, unitPrice: 2000 },
  { date: "2026-08-07", name: "Sauce graine + placali", qty: 1, unitPrice: 2000 },
  { date: "2026-08-07", name: "Sauce Tchayo + riz", qty: 2, unitPrice: 2000 },
  { date: "2026-08-07", name: "Poisson pané + riz", qty: 1, unitPrice: 2000 },
  { date: "2026-08-07", name: "Atassi + accompagnement", qty: 4, unitPrice: 2500 },
  { date: "2026-08-07", name: "Œuf", qty: 1, unitPrice: 150 },
  { date: "2026-08-07", name: "Brochette de poisson + riz", qty: 1, unitPrice: 1000 },
  { date: "2026-08-07", name: "Sauce Tchayo (portion seule)", qty: 1, unitPrice: 1000 },
];

/** Plats vendus seuls le 07/08 (compteurs inventaire, pas combo). */
const PLATS_SEULS_0708 = [
  { date: "2026-08-07", name: "Attasi", qty: 23 },
  { date: "2026-08-07", name: "Brochette de poisson", qty: 4 },
  { date: "2026-08-07", name: "Poisson Chawarma", qty: 4 },
  { date: "2026-08-07", name: "Poisson pané", qty: 4 },
  { date: "2026-08-07", name: "Sauce arachide", qty: 2 },
  { date: "2026-08-07", name: "Sauce graine", qty: 14 },
  { date: "2026-08-07", name: "Sauce légume", qty: 4 },
  { date: "2026-08-07", name: "Sauce Monyo", qty: 9 },
  { date: "2026-08-07", name: "Sauce Tchayo", qty: 4 },
  { date: "2026-08-07", name: "Sauce tomate", qty: 7 },
];

function loadCarnetSales() {
  const src = readFileSync(join(__dir, "import-carnet-zogbo-0808.mjs"), "utf8");
  const m = src.match(/const SALES = (\{[\s\S]*?\n\});/);
  if (!m) throw new Error("SALES introuvable");
  return eval(`(${m[1]})`);
}

const carnet = loadCarnetSales();
const mealLines = [...INV_0708];

for (const [date, lines] of Object.entries(carnet)) {
  for (const l of lines) {
    if (l.kind === "extra" || l.kind === "plat") {
      if (l.kind === "boisson") continue;
      mealLines.push({
        date,
        name: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
        kind: l.kind,
      });
    }
  }
}

const decomposed = mealLines.map((l) =>
  decomposeMealLine(l.name, l.qty, {
    date: l.date,
    unitPrice: l.unitPrice,
    kind: l.kind,
  }),
);

const totPlats = {};
const totAccs = {};
const byDatePlats = {};
const byDateAccs = {};
const anomalies = [];

for (const d of decomposed) {
  if (!byDatePlats[d.date]) byDatePlats[d.date] = {};
  if (!byDateAccs[d.date]) byDateAccs[d.date] = {};
  for (const [n, q] of Object.entries(d.plats)) {
    totPlats[n] = (totPlats[n] ?? 0) + q;
    byDatePlats[d.date][n] = (byDatePlats[d.date][n] ?? 0) + q;
  }
  for (const [n, q] of Object.entries(d.accs)) {
    totAccs[n] = (totAccs[n] ?? 0) + q;
    byDateAccs[d.date][n] = (byDateAccs[d.date][n] ?? 0) + q;
  }
  if (d.unknown.length) {
    anomalies.push({ date: d.date, line: d.rawName, qty: d.qty, unknown: d.unknown });
  }
  for (const f of d.flags) {
    anomalies.push({ date: d.date, line: d.rawName, qty: d.qty, flag: f.note, part: f.part });
  }
}

for (const p of PLATS_SEULS_0708) {
  totPlats[p.name] = (totPlats[p.name] ?? 0) + p.qty;
  if (!byDatePlats[p.date]) byDatePlats[p.date] = {};
  byDatePlats[p.date][p.name] = (byDatePlats[p.date][p.name] ?? 0) + p.qty;
}

console.log(JSON.stringify({
  periode: "2026-08-07 → 2026-08-10 (boissons exclues)",
  lignesRepas: mealLines.length + PLATS_SEULS_0708.length,
  totalPlats: totPlats,
  totalAccompagnements: totAccs,
  parJour: {
    plats: byDatePlats,
    accompagnements: byDateAccs,
  },
  detailLignes: decomposed.map((d) => ({
    date: d.date,
    raw: d.rawName,
    qty: d.qty,
    plats: d.plats,
    accs: d.accs,
    unknown: d.unknown,
  })),
  platsSeuls0708: PLATS_SEULS_0708,
  anomalies,
}, null, 2));
