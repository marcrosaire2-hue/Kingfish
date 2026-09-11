/**
 * Ventes matin Zogbo — 12/08/2026 (feuille papier, CA 4 350 F).
 *
 * IMPORTANT : n’écrit que `ventes_log` (CA / journal).
 * Ne touche PAS `boissons_jours` — le stock boissons a déjà été soustrait /
 * sera inventorié ce soir. Aucune nourriture dans ce ticket.
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-ventes-matin-zogbo-1208.mjs --dry-run
 *   node --env-file=.env.local scripts/import-ventes-matin-zogbo-1208.mjs --yes
 *
 * Mapping :
 *   FIFA 600 → drink-fifa-gb
 *   Petits Béninoise 350 → drink-beninoise-pb
 *   Piles 800 → drink-pils-gm (Pils)
 *   Petit joueh / jouet 300 → drink-youzou-sprite-pb (Youki, lecture incertaine)
 */
import { MongoClient, ObjectId } from "mongodb";

const SOURCE = "carnet-zogbo-1208-matin";
const SITE = "zogbo";
const DATE = "2026-08-12";
const EXPECTED_CA = 4350;
const EXPECTED_UNITS = 8;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}

const SALES = [
  {
    kind: "boisson",
    productId: "drink-fifa-gb",
    name: "FIFA GB",
    qty: 1,
    unitPrice: 600,
  },
  {
    kind: "boisson",
    productId: "drink-beninoise-pb",
    name: "Petit Béninoise (PB)",
    qty: 3,
    unitPrice: 350,
  },
  {
    kind: "boisson",
    productId: "drink-pils-gm",
    name: "Pils (Piles)",
    qty: 1,
    unitPrice: 800,
  },
  {
    kind: "boisson",
    productId: "drink-pils-gm",
    name: "Pils (Piles)",
    qty: 2,
    unitPrice: 800,
  },
  {
    kind: "boisson",
    productId: "drink-youzou-sprite-pb",
    name: "Petit Youki (lecture : joueh/jouet)",
    qty: 1,
    unitPrice: 300,
    note: "Écriture peu lisible sur la feuille",
  },
];

function at(hh, mm = 0) {
  const p = (n) => String(n).padStart(2, "0");
  return `${DATE}T${p(hh)}:${p(mm)}:00.000+01:00`;
}

function sumCa(lines) {
  return lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
}

function sumQty(lines) {
  return lines.reduce((s, l) => s + l.qty, 0);
}

async function main() {
  const ca = sumCa(SALES);
  const units = sumQty(SALES);
  if (ca !== EXPECTED_CA) {
    throw new Error(`CA total ${ca} ≠ attendu ${EXPECTED_CA}`);
  }
  if (units !== EXPECTED_UNITS) {
    throw new Error(`Unités ${units} ≠ attendu ${EXPECTED_UNITS}`);
  }

  const summary = {
    dryRun,
    date: DATE,
    site: SITE,
    source: SOURCE,
    ca,
    units,
    touchBoissonsStock: false,
    touchNourriture: false,
    note:
      "CA journal seulement — stock boissons non modifié (déjà soustrait / point ce soir). Pas de nourriture sur ce ticket.",
    lignes: SALES.map((l) => ({
      name: l.name,
      qty: l.qty,
      unitPrice: l.unitPrice,
      amount: l.qty * l.unitPrice,
      productId: l.productId,
    })),
  };

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");
  const parametres = await db.collection("parametres").findOne({
    _id: "parametres",
  });
  if (!parametres) throw new Error("parametres manquants");

  const drinkIds = new Set((parametres.drinks ?? []).map((d) => d.id));
  for (const line of SALES) {
    if (!drinkIds.has(line.productId)) {
      throw new Error(`Produit introuvable : ${line.productId} (${line.name})`);
    }
  }

  await db.collection("ventes_log").deleteMany({ date: DATE, source: SOURCE });

  const ventes = [];
  let h = 10;
  let m = 0;
  for (const line of SALES) {
    ventes.push({
      _id: new ObjectId(),
      date: DATE,
      site: SITE,
      kind: line.kind,
      productId: line.productId,
      name: line.name,
      qty: line.qty,
      unitPrice: line.unitPrice,
      costPrice: 0,
      amount: line.qty * line.unitPrice,
      at: at(h, m),
      cancelledAt: null,
      caExcluded: false,
      shift: "matin",
      source: SOURCE,
      note: line.note ?? "Feuille ventes matin 12/08 — stock boissons non touché",
    });
    m += 5;
    if (m >= 60) {
      h += 1;
      m = 0;
    }
  }

  await db.collection("ventes_log").insertMany(ventes);

  // Volontairement : aucune écriture dans boissons_jours / zogbo_jours.

  // Crédit de la caisse Zogbo : la caisse doit refléter toutes les ventes du
  // jour, y compris celles saisies depuis la feuille papier. Idempotent via
  // le marqueur caisse_ventes_credits (source + date + session).
  const credit = await (async () => {
    const total = ventes.reduce((s, d) => s + d.amount, 0);
    if (!total) return 0;
    const session = await db.collection("caisses_sessions").findOne({
      date: DATE,
      statut: "ouverte",
      $or: [{ caisse: SITE }, { caisse: { $exists: false }, site: SITE }],
    });
    if (!session) return 0;
    const sessionId = session._id.toHexString();
    const marker = await db
      .collection("caisse_ventes_credits")
      .findOne({ source: SOURCE, date: DATE, sessionId });
    const previous = marker?.total ?? 0;
    if (previous === total) return 0;
    await db.collection("caisses_sessions").updateOne(
      { _id: session._id },
      {
        $inc: { totalVente: total - previous },
        $set: { updatedAt: new Date().toISOString() },
      },
    );
    await db.collection("caisse_ventes_credits").updateOne(
      { source: SOURCE, date: DATE, sessionId },
      { $set: { total } },
      { upsert: true },
    );
    return 1;
  })();
  if (credit) {
    console.log("Caisse créditée", { date: DATE, site: SITE, ca });
  }

  console.log(
    JSON.stringify(
      {
        ...summary,
        inserted: ventes.length,
        boissonsJours: "non modifié",
        zogboJours: "non modifié",
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
