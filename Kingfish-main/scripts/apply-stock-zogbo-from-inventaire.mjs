/**
 * Aligne le stock Zogbo du site sur l’inventaire Excel 07/08 (colonne P)
 * puis déduit les ventes journal (plats + repas « extra » décomposés).
 *
 * Usage:
 *   node --env-file=.env.local scripts/apply-stock-zogbo-from-inventaire.mjs --dry-run
 *   node --env-file=.env.local scripts/apply-stock-zogbo-from-inventaire.mjs --yes
 */
import { MongoClient } from "mongodb";

const SOURCE = "stock-inventaire-marco";
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}

/** Inventaire Excel — feuille Stock Physique Théorique zogbo */
const INV_07 = [
  {
    productId: "base-brochette-de-poisson",
    name: "BROCHETTE DE POISSON",
    prepared: 67,
    sent: 21,
    sold: 4,
    counted: 21,
  },
  {
    productId: "base-chawarma-au-poisson",
    name: "CHAWARMA AU POISSON",
    prepared: 120,
    sent: 75,
    sold: 4,
    counted: 38,
  },
  {
    productId: "base-choukouya",
    name: "CHOUKOUYA",
    prepared: 31,
    sent: 10,
    sold: 0,
    counted: 7,
  },
  {
    productId: "base-friture-oeuf-fromage-wagashi-poisson",
    name: "FRITURE OEUF, FROMAGE,WAGASHI, POISSON",
    prepared: 50,
    sent: 55,
    sold: 0,
    counted: 21,
  },
  {
    productId: "base-poisson-pane",
    name: "POISSON PANE",
    prepared: 49,
    sent: 30,
    sold: 4,
    counted: 0,
  },
  {
    productId: "base-sauce-d-arachide",
    name: "Sauce d'arachide",
    prepared: 50,
    sent: 13,
    sold: 2,
    counted: 16,
  },
  {
    productId: "base-sauce-graine",
    name: "SAUCE GRAINE",
    prepared: 50,
    sent: 33,
    sold: 14,
    counted: 8,
  },
  {
    productId: "base-sauce-legumes-tchiayo-gboman",
    name: "SAUCE LEGUMES TCHIAYO GBOMAN",
    prepared: 41,
    sent: 20,
    sold: 4,
    counted: 10,
  },
  {
    productId: "base-sauce-monyo-au-poisson-fume",
    name: "SAUCE MONYO AU POISSON FUME",
    prepared: 86,
    sent: 65,
    sold: 9,
    counted: 5,
  },
  {
    productId: "base-sauce-tchiayo-broye",
    name: "SAUCE TCHIAYO BROYE",
    prepared: 50,
    sent: 25,
    sold: 4,
    counted: 19,
  },
  {
    productId: "base-sauce-tomate-piquante",
    name: "SAUCE TOMATE PIQUANTE",
    prepared: 96,
    sent: 58,
    sold: 7,
    counted: 18,
  },
];

/** Attasi : préparé à Zogbo mais catalogue « local » → accompanimentLines */
const ATTASI = {
  productId: "local-atassi",
  name: "ATASSI",
  prepared: 100,
  sent: 55,
  sold: 23,
  counted: 19,
};

const DATES = [
  "2026-08-08",
  "2026-08-09",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
];

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Impute une ligne repas extra → productId plat (ou null). */
function platFromExtraName(name) {
  const n = norm(name);
  if (n.includes("guinness") || n.includes("oeuf") || n.includes("œuf")) {
    return null;
  }
  if (n.includes("arachide")) return "base-sauce-d-arachide";
  if (n.includes("graine")) return "base-sauce-graine";
  if (n.includes("legume") || n.includes("légume")) {
    return "base-sauce-legumes-tchiayo-gboman";
  }
  if (n.includes("monyo")) return "base-sauce-monyo-au-poisson-fume";
  if (n.includes("tchayo") || n.includes("tchiayo")) {
    return "base-sauce-tchiayo-broye";
  }
  if (n.includes("tomate")) return "base-sauce-tomate-piquante";
  // « Sauce poisson frais » : pas d’imputation catalogue (à clarifier)
  if (n.includes("poisson frais")) return null;
  if (n.includes("atassi") || n.includes("attasi")) return "local-atassi";
  if (n.includes("brochette")) return "base-brochette-de-poisson";
  if (n.includes("chawarma") || n.includes("charrois")) {
    return "base-chawarma-au-poisson";
  }
  if (n.includes("choucouya") || n.includes("choukouya")) {
    return "base-choukouya";
  }
  if (n.includes("friture")) {
    return "base-friture-oeuf-fromage-wagashi-poisson";
  }
  if (n.includes("pane") || n.includes("pané")) return "base-poisson-pane";
  return null;
}

function emptyPlatLine(d) {
  return {
    productId: d.id,
    name: d.name,
    stock: 0,
    prepared: 0,
    sentToGbegamey: 0,
    sold: 0,
    pertes: 0,
    counted: null,
    observations: "",
  };
}

function emptyAccLine(d) {
  return {
    productId: d.id,
    name: d.name,
    initialStock: 0,
    prepared: 0,
    sold: 0,
    pertes: 0,
    counted: null,
    observations: "",
  };
}

async function soldByProductForDate(db, date) {
  const docs = await db
    .collection("ventes_log")
    .find({
      date,
      site: "zogbo",
      cancelledAt: null,
      caExcluded: { $ne: true },
      kind: { $in: ["plat", "extra", "local"] },
    })
    .toArray();

  const sold = new Map();
  const notes = [];
  for (const d of docs) {
    let productId = null;
    if (d.kind === "plat" || d.kind === "local") {
      productId = d.productId;
    } else {
      productId = platFromExtraName(d.name);
      if (!productId) {
        if (norm(d.name).includes("poisson frais")) {
          notes.push(
            `${d.qty}× « ${d.name} » non déduit(s) du stock plats (mapping à confirmer)`,
          );
        }
        continue;
      }
    }
    sold.set(productId, (sold.get(productId) ?? 0) + (d.qty || 0));
  }
  return { sold, notes };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");
  const parametres = await db.collection("parametres").findOne({
    _id: "parametres",
  });
  if (!parametres) throw new Error("parametres manquants");

  const baseDishes = parametres.baseDishes ?? [];
  const localDishes = parametres.localDishes ?? [];
  const invById = new Map(INV_07.map((r) => [r.productId, r]));

  // —— 07/08 ——
  const existing07 = await db.collection("zogbo_jours").findOne({
    _id: "2026-08-07",
  });
  const lines07 = baseDishes.map((d) => {
    const inv = invById.get(d.id);
    if (!inv) return emptyPlatLine(d);
    const prepared = Math.max(inv.prepared, inv.sent);
    const stock = Math.max(0, prepared - inv.sent);
    return {
      productId: d.id,
      name: d.name,
      stock,
      prepared,
      sentToGbegamey: inv.sent,
      sold: inv.sold,
      pertes: 0,
      counted: inv.counted,
      observations: "Inventaire marco.xlsx — compté physique 07/08",
    };
  });

  // Attasi : reste après envoi = prepared − sent ; vendu sur place à part.
  const attasiKept = Math.max(0, ATTASI.prepared - ATTASI.sent);
  const acc07 = localDishes.map((d) => {
    if (d.id !== ATTASI.productId) return emptyAccLine(d);
    return {
      productId: ATTASI.productId,
      name: d.name,
      initialStock: 0,
      prepared: attasiKept,
      sold: ATTASI.sold,
      pertes: 0,
      counted: ATTASI.counted,
      observations:
        "Inventaire marco — Attasi Zogbo (préparé 100, envoyé Gbé 55)",
    };
  });

  const leftoverPlats = new Map();
  for (const l of lines07) {
    leftoverPlats.set(
      l.productId,
      l.counted !== null && l.counted !== undefined
        ? l.counted
        : Math.max(0, l.stock - l.sold),
    );
  }
  let leftoverAttasi = ATTASI.counted;

  const summary = {
    dryRun,
    "2026-08-07": {
      plats: lines07
        .filter((l) => invById.has(l.productId))
        .map((l) => ({
          name: l.name,
          stock: l.stock,
          sold: l.sold,
          counted: l.counted,
          reste: l.counted,
        })),
      attasi: { counted: ATTASI.counted },
    },
    days: {},
  };

  if (!dryRun) {
    await db.collection("zogbo_jours").replaceOne(
      { _id: "2026-08-07" },
      {
        _id: "2026-08-07",
        status: existing07?.status ?? "cloturee",
        lines: lines07,
        accompanimentLines: acc07,
        movements: existing07?.movements ?? [],
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        rev: (existing07?.rev ?? 0) + 1,
      },
      { upsert: true },
    );
  }

  for (const date of DATES) {
    const { sold, notes } = await soldByProductForDate(db, date);
    const existing = await db.collection("zogbo_jours").findOne({ _id: date });

    const lines = baseDishes.map((d) => {
      const opening = leftoverPlats.get(d.id) ?? 0;
      const soldToday = sold.get(d.id) ?? 0;
      const reste = opening - soldToday;
      leftoverPlats.set(d.id, Math.max(0, reste));
      const noteBits = [];
      if (opening > 0 || soldToday > 0) {
        noteBits.push(`Report inventaire · ouverture ${opening}`);
      }
      if (soldToday > 0) noteBits.push(`vendu journal ${soldToday}`);
      return {
        productId: d.id,
        name: d.name,
        stock: opening,
        prepared: opening,
        sentToGbegamey: 0,
        sold: soldToday,
        pertes: 0,
        counted: Math.max(0, reste),
        observations: noteBits.join(" · "),
      };
    });
    if (notes.length) {
      const anchor = lines.find((l) => l.stock > 0 || l.sold > 0);
      if (anchor) {
        anchor.observations = [anchor.observations, ...notes]
          .filter(Boolean)
          .join(" · ");
      }
    }

    const attasiOpening = leftoverAttasi;
    const attasiSold = sold.get(ATTASI.productId) ?? 0;
    const attasiReste = Math.max(0, attasiOpening - attasiSold);
    leftoverAttasi = attasiReste;

    const accLines = localDishes.map((d) => {
      if (d.id !== ATTASI.productId) return emptyAccLine(d);
      return {
        productId: d.id,
        name: d.name,
        initialStock: attasiOpening,
        prepared: 0,
        sold: attasiSold,
        pertes: 0,
        counted: attasiReste,
        observations: `Report inventaire Attasi · ouverture ${attasiOpening}`,
      };
    });

    summary.days[date] = {
      plats: lines
        .filter((l) => l.stock > 0 || l.sold > 0 || l.counted > 0)
        .map((l) => ({
          name: l.name,
          ouverture: l.stock,
          vendu: l.sold,
          reste: l.counted,
        })),
      attasi: {
        ouverture: attasiOpening,
        vendu: attasiSold,
        reste: Math.max(0, attasiOpening - attasiSold),
      },
      notes,
    };

    if (!dryRun) {
      await db.collection("zogbo_jours").replaceOne(
        { _id: date },
        {
          _id: date,
          status: existing?.status ?? "ouverte",
          lines,
          accompanimentLines: accLines,
          movements: existing?.movements ?? [],
          updatedAt: new Date().toISOString(),
          source: SOURCE,
          rev: (existing?.rev ?? 0) + 1,
        },
        { upsert: true },
      );
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
