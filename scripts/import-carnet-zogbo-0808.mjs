/**
 * Import du carnet manuscrit Zogbo — ventes du 08, 09 et 10/08/2026.
 * Source : CamScanner 12-08-2026 14.10.pdf
 *
 * Écrit dans ventes_log (prix réels du carnet) et met à jour les compteurs
 * vendus Zogbo (plats + boissons). Idempotent : remplace source "carnet-zogbo".
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-carnet-zogbo-0808.mjs --dry-run
 *   node --env-file=.env.local scripts/import-carnet-zogbo-0808.mjs --yes
 */
import { MongoClient, ObjectId } from "mongodb";

const SOURCE = "carnet-zogbo";
const SITE = "zogbo";
const DATES = ["2026-08-08", "2026-08-09", "2026-08-10"];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}

/** @type {Record<string, Array<{ kind: 'plat'|'boisson'|'extra', productId?: string, name: string, qty: number, unitPrice: number }>>} */
const SALES = {
  "2026-08-08": [
    { kind: "boisson", productId: "drink-beninoise-gb", name: "Béninoise GB", qty: 2, unitPrice: 600 },
    { kind: "boisson", productId: "drink-kankpe-gb", name: "Kankpé GB", qty: 2, unitPrice: 600 },
    { kind: "extra", name: "Sauce d'arachide + Riz", qty: 1, unitPrice: 1500 },
    { kind: "boisson", productId: "drink-pamplemousse-pb", name: "PAMPLEMOUSSE PB", qty: 1, unitPrice: 300 },
    { kind: "extra", name: "Sauce graine + Telibo", qty: 1, unitPrice: 1500 },
    { kind: "extra", name: "Sauce d'arachide + Riz", qty: 1, unitPrice: 1500 },
    { kind: "boisson", productId: "drink-beninoise-gb", name: "Béninoise GB", qty: 1, unitPrice: 600 },
    { kind: "extra", name: "Guinness", qty: 1, unitPrice: 800 },
    { kind: "boisson", productId: "drink-contesse-fruit", name: "CONTESSE FRUIT", qty: 1, unitPrice: 600 },
    { kind: "boisson", productId: "drink-flag-gb", name: "Flag GB", qty: 2, unitPrice: 600 },
    { kind: "boisson", productId: "drink-flag-gb", name: "Flag GB", qty: 1, unitPrice: 600 },
    { kind: "boisson", productId: "drink-kankpe-gb", name: "Kankpé GB", qty: 1, unitPrice: 600 },
    { kind: "boisson", productId: "drink-contesse-fruit", name: "CONTESSE FRUIT", qty: 3, unitPrice: 600 },
    { kind: "boisson", productId: "drink-flag-gb", name: "Flag GB", qty: 1, unitPrice: 600 },
    { kind: "boisson", productId: "drink-doppel-gb", name: "Doppel GB", qty: 1, unitPrice: 600 },
    { kind: "boisson", productId: "drink-kankpe-gb", name: "Kankpé GB", qty: 1, unitPrice: 600 },
    { kind: "boisson", productId: "drink-beninoise-gb", name: "Béninoise GB", qty: 1, unitPrice: 600 },
    { kind: "boisson", productId: "drink-kankpe-gb", name: "Kankpé GB", qty: 1, unitPrice: 600 },
    { kind: "boisson", productId: "drink-doppel-gb", name: "Doppel GB", qty: 2, unitPrice: 600 },
    { kind: "boisson", productId: "drink-kankpe-gb", name: "Kankpé GB", qty: 1, unitPrice: 600 },
    { kind: "plat", productId: "base-sauce-d-arachide", name: "Sauce d'arachide", qty: 1, unitPrice: 1000 },
    { kind: "boisson", productId: "drink-flag-gb", name: "Flag GB", qty: 19, unitPrice: 600 },
    { kind: "boisson", productId: "drink-beaufort-gb", name: "Beaufort GB", qty: 9, unitPrice: 600 },
    { kind: "boisson", productId: "drink-coca-cola-gb", name: "COCA COLA GB", qty: 2, unitPrice: 500 },
    { kind: "boisson", productId: "drink-kankpe-gb", name: "Kankpé GB", qty: 4, unitPrice: 600 },
    { kind: "boisson", productId: "drink-fifa-gb", name: "FIFA GB", qty: 2, unitPrice: 600 },
    {
      kind: "extra",
      name: "Sauce poisson frais + Telibo + Riz + Pâte de maïs",
      qty: 8,
      unitPrice: 1500,
    },
    { kind: "extra", name: "Sauce d'arachide + Riz", qty: 2, unitPrice: 1500 },
    {
      kind: "extra",
      name: "Sauce légume + Pâte de maïs",
      qty: 1,
      unitPrice: 1500,
    },
    { kind: "extra", name: "Guinness", qty: 5, unitPrice: 800 },
  ],
  "2026-08-09": [
    { kind: "boisson", productId: "drink-flag-gb", name: "Flag GB", qty: 1, unitPrice: 600 },
    { kind: "boisson", productId: "drink-castel-gb", name: "Castel GB", qty: 1, unitPrice: 500 },
    { kind: "boisson", productId: "drink-beninoise-pb", name: "BENINOISE PB", qty: 1, unitPrice: 350 },
    { kind: "boisson", productId: "drink-pamplemousse-pb", name: "PAMPLEMOUSSE PB", qty: 1, unitPrice: 300 },
    { kind: "boisson", productId: "drink-beaufort-gb", name: "Beaufort GB", qty: 1, unitPrice: 600 },
    { kind: "boisson", productId: "drink-contesse-fruit", name: "CONTESSE FRUIT", qty: 1, unitPrice: 600 },
    { kind: "boisson", productId: "drink-pamplemousse-pb", name: "PAMPLEMOUSSE PB", qty: 1, unitPrice: 300 },
    { kind: "boisson", productId: "drink-moka-pb", name: "MOKA PB", qty: 1, unitPrice: 400 },
    { kind: "boisson", productId: "drink-castel-gb", name: "Castel GB", qty: 1, unitPrice: 500 },
    { kind: "boisson", productId: "drink-pils-gm", name: "PILS GM", qty: 1, unitPrice: 800 },
    { kind: "boisson", productId: "drink-beaufort-gb", name: "Beaufort GB", qty: 1, unitPrice: 600 },
  ],
  "2026-08-10": [
    { kind: "extra", name: "Guinness", qty: 1, unitPrice: 800 },
    { kind: "boisson", productId: "drink-moka-pb", name: "MOKA PB", qty: 1, unitPrice: 300 },
    { kind: "extra", name: "Monyo + Piron", qty: 2, unitPrice: 1500 },
    { kind: "boisson", productId: "drink-beninoise-gb", name: "Béninoise GB", qty: 1, unitPrice: 600 },
    { kind: "boisson", productId: "drink-castel-gb", name: "Castel GB", qty: 2, unitPrice: 500 },
    { kind: "boisson", productId: "drink-hagbe-gb", name: "HAGBE GB", qty: 4, unitPrice: 600 },
    { kind: "boisson", productId: "drink-beninoise-gb", name: "Béninoise GB", qty: 1, unitPrice: 600 },
  ],
};

/** Totaux de contrôle transcrits du carnet. */
const CONTROLE = {
  "2026-08-08": 61100,
  "2026-08-09": 5550,
  "2026-08-10": 8700,
};

function at(date, hh, mm = 0) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date}T${p(hh)}:${p(mm)}:00.000+01:00`;
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

  const doc = {
    _id: date,
    status: existing?.status ?? "cloturee",
    lines: [...byId.values()],
    movements: existing?.movements ?? [],
    updatedAt: new Date().toISOString(),
    source: existing?.source ?? SOURCE,
    rev: (existing?.rev ?? 0) + 1,
  };

  await col.replaceOne({ _id: date }, doc, { upsert: true });
  return doc.lines.filter((l) => l.sold > 0).length;
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

  const doc = {
    _id: date,
    status: existing?.status ?? "cloturee",
    lines: [...byId.values()],
    movements: existing?.movements ?? [],
    updatedAt: new Date().toISOString(),
    source: existing?.source ?? SOURCE,
    rev: (existing?.rev ?? 0) + 1,
  };

  await col.replaceOne({ _id: date }, doc, { upsert: true });
  return doc.lines.filter((l) => l.soldZogbo > 0).length;
}

async function main() {
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
  for (const date of DATES) {
    for (const line of SALES[date]) {
      if (line.productId && !catalogIds.has(line.productId)) {
        throw new Error(`${date} : produit introuvable ${line.productId}`);
      }
    }
  }

  const report = [];

  for (const date of DATES) {
    const lines = SALES[date];
    const ca = sumCa(lines);
    const attendu = CONTROLE[date];
    if (ca !== attendu) {
      throw new Error(`${date} : CA calculé ${ca} ≠ carnet ${attendu}`);
    }

    const { plats, boissons } = aggregateSold(lines);
    const ventes = [];
    let h = 10;
    let m = 0;
    const nextAt = () => {
      const t = at(date, h, m);
      m += 5;
      if (m >= 60) {
        m = 0;
        h += 1;
      }
      return t;
    };

    for (const line of lines) {
      const amount = line.qty * line.unitPrice;
      ventes.push({
        _id: new ObjectId(),
        date,
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
        amount,
        at: nextAt(),
        cancelledAt: null,
        caExcluded: false,
        shift: null,
        source: SOURCE,
      });
    }

    if (!dryRun) {
      await db.collection("ventes_log").deleteMany({ date, source: SOURCE });
      if (ventes.length) await db.collection("ventes_log").insertMany(ventes);
      const platsRenseignes = await ensureZogboLines(db, date, parametres, plats);
      const boissonsRenseignes = await ensureBoissonLines(
        db,
        date,
        parametres,
        boissons,
      );
      report.push({
        date,
        ca,
        lignes: ventes.length,
        platsRenseignes,
        boissonsRenseignes,
      });
    } else {
      report.push({
        date,
        ca,
        attendu,
        lignes: ventes.length,
        plats: [...plats.entries()],
        boissons: [...boissons.entries()],
      });
    }
  }

  console.log(JSON.stringify({ dryRun, report }, null, 2));
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
