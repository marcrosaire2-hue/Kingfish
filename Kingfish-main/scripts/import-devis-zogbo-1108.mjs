/**
 * Import devis Zogbo — matinée du 11/08/2026 (N°230 à 233).
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-devis-zogbo-1108.mjs --dry-run
 *   node --env-file=.env.local scripts/import-devis-zogbo-1108.mjs --yes
 */
import { MongoClient, ObjectId } from "mongodb";

const SOURCE = "devis-zogbo";
const SITE = "zogbo";
const DATE = "2026-08-11";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}

/** Lignes regroupées — prix réels des devis. */
const SALES = [
  // Devis 230 — 2 700 F
  {
    devis: 230,
    kind: "boisson",
    productId: "drink-hagbe-gb",
    name: "Haslé GB",
    qty: 2,
    unitPrice: 600,
  },
  {
    devis: 230,
    kind: "extra",
    name: "Plat de sauce légume + Tilézo",
    qty: 1,
    unitPrice: 1500,
  },
  // Devis 231 — 3 600 F
  {
    devis: 231,
    kind: "extra",
    name: "Plat d'atassi",
    qty: 2,
    unitPrice: 1500,
  },
  {
    devis: 231,
    kind: "boisson",
    productId: "drink-coca-cola-pb",
    name: "Petit World Cola",
    qty: 2,
    unitPrice: 300,
  },
  // Devis 232 — 5 400 F
  {
    devis: 232,
    kind: "boisson",
    productId: "drink-beninoise-gb",
    name: "Grande Béninoise",
    qty: 6,
    unitPrice: 600,
  },
  {
    devis: 232,
    kind: "boisson",
    productId: "drink-beaufort-gb",
    name: "Grande Beaufort",
    qty: 3,
    unitPrice: 600,
  },
  // Devis 233 — 4 400 F
  {
    devis: 233,
    kind: "extra",
    name: "Guinness",
    qty: 2,
    unitPrice: 800,
  },
  {
    devis: 233,
    kind: "boisson",
    productId: "drink-coca-cola-gb",
    name: "Grande World Cola",
    qty: 1,
    unitPrice: 500,
  },
  {
    devis: 233,
    kind: "extra",
    name: "Plat de sauce arachide + Tilézo",
    qty: 1,
    unitPrice: 1500,
  },
  {
    devis: 233,
    kind: "boisson",
    productId: "drink-lager-gb",
    name: "Lager GB",
    qty: 1,
    unitPrice: 800,
  },
];

const CONTROLE = {
  230: 2700,
  231: 3600,
  232: 5400,
  233: 4400,
  total: 16100,
};

function at(hh, mm = 0) {
  const p = (n) => String(n).padStart(2, "0");
  return `${DATE}T${p(hh)}:${p(mm)}:00.000+01:00`;
}

function sumCa(lines) {
  return lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
}

function aggregateSold(lines) {
  const plats = new Map();
  const boissons = new Map();
  for (const l of lines) {
    if (l.kind === "plat" && l.productId) {
      plats.set(l.productId, (plats.get(l.productId) ?? 0) + l.qty);
    }
    if (l.kind === "boisson" && l.productId) {
      boissons.set(l.productId, (boissons.get(l.productId) ?? 0) + l.qty);
    }
  }
  return { plats, boissons };
}

async function ensureZogboLines(db, date, parametres, platSold) {
  const col = db.collection("zogbo_jours");
  const existing = await col.findOne({ _id: date });
  const byId = new Map((existing?.lines ?? []).map((l) => [l.productId, { ...l }]));

  for (const d of parametres.baseDishes ?? []) {
    if (!byId.has(d.id)) {
      byId.set(d.id, {
        productId: d.id,
        name: d.name,
        stock: 0,
        prepared: 0,
        sentToGbegamey: 0,
        sold: 0,
        counted: null,
        observations: "",
      });
    }
  }

  for (const [productId, qty] of platSold) {
    const line = byId.get(productId);
    if (line) line.sold = (line.sold ?? 0) + qty;
  }

  await col.replaceOne(
    { _id: date },
    {
      _id: date,
      status: existing?.status ?? "cloturee",
      lines: [...byId.values()],
      movements: existing?.movements ?? [],
      updatedAt: new Date().toISOString(),
      source: existing?.source ?? SOURCE,
      rev: (existing?.rev ?? 0) + 1,
    },
    { upsert: true },
  );
}

async function ensureBoissonLines(db, date, parametres, boissonSold) {
  const col = db.collection("boissons_jours");
  const existing = await col.findOne({ _id: date });
  const byId = new Map((existing?.lines ?? []).map((l) => [l.productId, { ...l }]));

  for (const d of parametres.drinks ?? []) {
    if (!byId.has(d.id)) {
      byId.set(d.id, {
        productId: d.id,
        name: d.name,
        initialStock: 0,
        purchases: 0,
        soldZogbo: 0,
        soldGbegamey: 0,
        pertes: 0,
        counted: null,
        observations: "",
      });
    }
  }

  for (const [productId, qty] of boissonSold) {
    const line = byId.get(productId);
    if (line) line.soldZogbo = (line.soldZogbo ?? 0) + qty;
  }

  await col.replaceOne(
    { _id: date },
    {
      _id: date,
      status: existing?.status ?? "cloturee",
      lines: [...byId.values()],
      movements: existing?.movements ?? [],
      updatedAt: new Date().toISOString(),
      source: existing?.source ?? SOURCE,
      rev: (existing?.rev ?? 0) + 1,
    },
    { upsert: true },
  );
}

async function main() {
  const ca = sumCa(SALES);
  if (ca !== CONTROLE.total) {
    throw new Error(`CA total ${ca} ≠ attendu ${CONTROLE.total}`);
  }

  for (const n of [230, 231, 232, 233]) {
    const sub = SALES.filter((l) => l.devis === n);
    const subCa = sumCa(sub);
    if (subCa !== CONTROLE[n]) {
      throw new Error(`Devis ${n} : CA ${subCa} ≠ ${CONTROLE[n]}`);
    }
  }

  const { plats, boissons } = aggregateSold(SALES);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          date: DATE,
          ca,
          lignes: SALES.length,
          parDevis: Object.fromEntries(
            [230, 231, 232, 233].map((n) => [
              n,
              {
                ca: CONTROLE[n],
                lignes: SALES.filter((l) => l.devis === n).length,
              },
            ]),
          ),
          plats: [...plats.entries()],
          boissons: [...boissons.entries()],
          repasExtra: SALES.filter((l) => l.kind === "extra").map((l) => ({
            devis: l.devis,
            name: l.name,
            qty: l.qty,
            unitPrice: l.unitPrice,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");
  const parametres = await db.collection("parametres").findOne({ _id: "parametres" });
  if (!parametres) throw new Error("parametres manquants");

  const catalogIds = new Set([
    ...(parametres.baseDishes ?? []).map((d) => d.id),
    ...(parametres.drinks ?? []).map((d) => d.id),
  ]);
  for (const line of SALES) {
    if (line.productId && !catalogIds.has(line.productId)) {
      throw new Error(`Produit introuvable : ${line.productId} (${line.name})`);
    }
  }

  const ventes = [];
  let h = 8;
  let m = 0;
  const nextAt = () => {
    const t = at(h, m);
    m += 4;
    if (m >= 60) {
      m = 0;
      h += 1;
    }
    return t;
  };

  for (const line of SALES) {
    ventes.push({
      _id: new ObjectId(),
      date: DATE,
      site: SITE,
      kind: line.kind,
      productId:
        line.productId ??
        `extra-${line.name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 40)}`,
      name: line.name,
      qty: line.qty,
      unitPrice: line.unitPrice,
      costPrice: 0,
      amount: line.qty * line.unitPrice,
      at: nextAt(),
      cancelledAt: null,
      caExcluded: false,
      shift: null,
      source: SOURCE,
      devisNo: line.devis,
    });
  }

  await db.collection("ventes_log").deleteMany({ date: DATE, source: SOURCE });
  if (ventes.length) await db.collection("ventes_log").insertMany(ventes);
  await ensureZogboLines(db, DATE, parametres, plats);
  await ensureBoissonLines(db, DATE, parametres, boissons);

  console.log(
    JSON.stringify(
      {
        dryRun,
        date: DATE,
        ca,
        lignes: ventes.length,
        parDevis: Object.fromEntries(
          [230, 231, 232, 233].map((n) => [
            n,
            { ca: CONTROLE[n], lignes: SALES.filter((l) => l.devis === n).length },
          ]),
        ),
        plats: [...plats.entries()],
        boissons: [...boissons.entries()],
        repasExtra: SALES.filter((l) => l.kind === "extra").map((l) => ({
          devis: l.devis,
          name: l.name,
          qty: l.qty,
        })),
      },
      null,
      2,
    ),
  );

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
