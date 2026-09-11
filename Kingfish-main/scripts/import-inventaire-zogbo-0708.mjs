/**
 * Import « Inventaire marco.xlsx » — journée du registre : 2026-08-07
 * (horodatage Africa/Porto-Novo, UTC+1)
 *
 * Contrairement à import-inventaire-marco.mjs, ce script s’insère dans une base
 * déjà peuplée par la chaîne AquaPro :
 *
 *   - le catalogue `parametres` est CONSERVÉ (les journées existantes pointent
 *     dessus par productId) ; seuls les combos manquants sont ajoutés ;
 *   - les noms de l’Excel sont rattachés au catalogue AquaPro via MAP ci-dessous ;
 *   - les ventes AquaPro du 07/08 (point de vente Gbégamey) ne sont PAS touchées.
 *     Seules les ventes de Zogbo, absentes d’AquaPro, entrent dans `ventes_log` ;
 *   - les doublons de sauces du catalogue AquaPro sont fusionnés au passage.
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-inventaire-zogbo-0708.mjs --dry-run
 *   node --env-file=.env.local scripts/import-inventaire-zogbo-0708.mjs --yes
 */
import { MongoClient, ObjectId } from "mongodb";
import { randomBytes } from "crypto";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}

const DATE = "2026-08-07";
const OBS = "Inventaire marco.xlsx — stock au 07/08/2026";

function newId() {
  return randomBytes(8).toString("hex");
}

/** Horodatage Bénin (UTC+1, pas de DST) */
function at(hh, mm = 0, ss = 0) {
  const p = (n) => String(n).padStart(2, "0");
  return `${DATE}T${p(hh)}:${p(mm)}:${p(ss)}.000+01:00`;
}

/**
 * Doublons du catalogue AquaPro : `from` disparaît, ses ventes et ses stocks
 * sont reportés sur `to`. L’orthographe TCHIAYO est retenue par cohérence avec
 * « SAUCE LEGUMES TCHIAYO GBOMAN » et avec le stock d’ouverture AquaPro.
 */
const MERGES = [
  { from: "base-sauce-monyo-poisson-fume", to: "base-sauce-monyo-au-poisson-fume" },
  { from: "base-sauce-tchayo-broye", to: "base-sauce-tchiayo-broye" },
];

/** Excel → catalogue. `kind` suit la classification AquaPro. */
const MAP = {
  Attasi: { id: "local-atassi", kind: "local" },
  "Brochette de poisson": { id: "base-brochette-de-poisson", kind: "plat" },
  Choucouya: { id: "base-choukouya", kind: "plat" },
  Friture: { id: "base-friture-oeuf-fromage-wagashi-poisson", kind: "plat" },
  "Poisson Chawarma": { id: "base-chawarma-au-poisson", kind: "plat" },
  "Poisson pané": { id: "base-poisson-pane", kind: "plat" },
  "Sauce arachide": { id: "base-sauce-d-arachide", kind: "plat" },
  "Sauce graine": { id: "base-sauce-graine", kind: "plat" },
  "Sauce légume": { id: "base-sauce-legumes-tchiayo-gboman", kind: "plat" },
  "Sauce Monyo": { id: "base-sauce-monyo-au-poisson-fume", kind: "plat" },
  "Sauce Tchayo": { id: "base-sauce-tchiayo-broye", kind: "plat" },
  "Sauce tomate": { id: "base-sauce-tomate-piquante", kind: "plat" },
  Frites: { id: "local-frites", kind: "local" },
  Riz: { id: "local-riz", kind: "local" },
  "Légume sauté": { id: "local-legume-saute", kind: "local" },
  "Pâte de Maïs": { id: "local-pate-de-mais", kind: "local" },
  "Pate noire": { id: "local-pate-noire", kind: "local" },
  "Piron blanc": { id: "local-piron-blanc", kind: "local" },
  "Piron rouge": { id: "local-piron-rouge", kind: "local" },
  Spaghetti: { id: "local-spaghetti", kind: "local" },
  Telibo: { id: "local-telibo", kind: "local" },
  "Wassa Wassa": { id: "local-wassa-wassa", kind: "local" },
};

/** Feuille « Stock Physique Théorique zogbo » */
const ZOGBO = [
  { name: "Attasi", prepared: 100, sent: 55, sold: 23, counted: 19 },
  { name: "Brochette de poisson", prepared: 67, sent: 21, sold: 4, counted: 21 },
  { name: "Choucouya", prepared: 31, sent: 10, sold: 0, counted: 7 },
  { name: "Friture", prepared: 50, sent: 55, sold: 0, counted: 21 },
  { name: "Poisson Chawarma", prepared: 120, sent: 75, sold: 4, counted: 38 },
  { name: "Poisson pané", prepared: 49, sent: 30, sold: 4, counted: 0 },
  { name: "Sauce arachide", prepared: 50, sent: 13, sold: 2, counted: 16 },
  { name: "Sauce graine", prepared: 50, sent: 33, sold: 14, counted: 8 },
  { name: "Sauce légume", prepared: 41, sent: 20, sold: 4, counted: 10 },
  { name: "Sauce Monyo", prepared: 86, sent: 65, sold: 9, counted: 5 },
  { name: "Sauce Tchayo", prepared: 50, sent: 25, sold: 4, counted: 19 },
  { name: "Sauce tomate", prepared: 96, sent: 58, sold: 7, counted: 18 },
];

/** Feuille « Stock Physique Théorique Gbegam » — plats reçus de Zogbo */
const GBEGAMEY_TRANSFER = [
  { name: "Attasi", received: 45, sold: 10, counted: 31 },
  { name: "Brochette de poisson", received: 31, sold: 16, counted: 14 },
  { name: "Choucouya", received: 0, sold: 0, counted: 0 },
  { name: "Friture", received: 25, sold: 13, counted: 21 },
  { name: "Poisson Chawarma", received: 75, sold: 68, counted: 16 },
  { name: "Poisson pané", received: 35, sold: 25, counted: 21 },
  { name: "Sauce arachide", received: 21, sold: 1, counted: 20 },
  { name: "Sauce graine", received: 26, sold: 1, counted: 21 },
  { name: "Sauce légume", received: 25, sold: 8, counted: 17 },
  { name: "Sauce Monyo", received: 62, sold: 9, counted: 57 },
  { name: "Sauce Tchayo", received: 49, sold: 30, counted: 21 },
  { name: "Sauce tomate", received: 35, sold: 8, counted: 12 },
];

/** Plats préparés à Gbégamey même */
const GBEGAMEY_LOCAL = [
  { name: "Frites", prepared: 21, sold: 21, counted: 0, unitPrice: 500 },
  { name: "Riz", prepared: 32, sold: 32, counted: 0, unitPrice: 500 },
  { name: "Légume sauté", prepared: 11, sold: 11, counted: 0, unitPrice: 1000 },
  { name: "Pâte de Maïs", prepared: 1, sold: 1, counted: 0, unitPrice: 500 },
  { name: "Pate noire", prepared: 9, sold: 9, counted: 0, unitPrice: 500 },
  { name: "Piron blanc", prepared: 6, sold: 6, counted: 0, unitPrice: 500 },
  { name: "Piron rouge", prepared: 1, sold: 1, counted: 0, unitPrice: 500 },
  { name: "Spaghetti", prepared: 13, sold: 13, counted: 0, unitPrice: 500 },
  { name: "Telibo", prepared: 9, sold: 9, counted: 0, unitPrice: 500 },
  { name: "Wassa Wassa", prepared: 2, sold: 2, counted: 0, unitPrice: 500 },
];

/** Combos vendus à Zogbo (bas de la feuille zogbo) */
const COMBOS_SOLD_ZOGBO = [
  { name: "Sauce tomate + riz", qty: 1, unitPrice: 2000, base: "Sauce tomate" },
  { name: "Sauce graine + placali", qty: 1, unitPrice: 2000, base: "Sauce graine" },
  { name: "Sauce Tchayo + riz", qty: 2, unitPrice: 2000, base: "Sauce Tchayo" },
  { name: "Poisson pané + riz", qty: 1, unitPrice: 2000, base: "Poisson pané" },
  { name: "Atassi + accompagnement", qty: 4, unitPrice: 2500, base: "Attasi" },
  { name: "Œuf", qty: 1, unitPrice: 150, base: null },
  { name: "Brochette de poisson + riz", qty: 1, unitPrice: 1000, base: "Brochette de poisson" },
  { name: "Sauce Tchayo (portion seule)", qty: 1, unitPrice: 1000, base: "Sauce Tchayo" },
];

/** Totaux de contrôle de la ligne TOTAL de la feuille zogbo. */
const CONTROLE = { platsVendus: 75, caPlats: 112500, caCombos: 22150 };

function comboId(name) {
  return `combo-${name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant (utilisez --env-file=.env.local)");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");
  const now = at(22, 30);
  const report = { date: DATE, dryRun };

  const parametres = await db.collection("parametres").findOne({ _id: "parametres" });
  if (!parametres) throw new Error("parametres manquants");

  const catalog = new Map();
  for (const k of ["baseDishes", "localDishes", "drinks", "combos"]) {
    for (const d of parametres[k] || []) catalog.set(d.id, d);
  }

  // Toute entrée de MAP doit exister : sans ça l’import écrirait des lignes
  // orphelines que l’application n’afficherait jamais.
  const missing = Object.entries(MAP)
    .filter(([, v]) => !catalog.has(v.id))
    .map(([k, v]) => `${k} → ${v.id}`);
  if (missing.length) {
    throw new Error(`Produits introuvables au catalogue :\n  ${missing.join("\n  ")}`);
  }

  const resolve = (name) => {
    const hit = MAP[name];
    if (!hit) throw new Error(`Nom sans correspondance : ${name}`);
    return { ...hit, name: catalog.get(hit.id).name };
  };

  // ——— 1. Fusion des doublons du catalogue ———
  const merges = [];
  for (const { from, to } of MERGES) {
    if (!catalog.has(from)) {
      merges.push({ from, to, skipped: "déjà fusionné" });
      continue;
    }
    const target = catalog.get(to);
    const ventes = await db
      .collection("ventes_log")
      .countDocuments({ productId: from });
    if (!dryRun) {
      await db
        .collection("ventes_log")
        .updateMany({ productId: from }, { $set: { productId: to, name: target.name } });
      await db.collection("parametres").updateOne(
        { _id: "parametres" },
        { $pull: { baseDishes: { id: from } } },
      );
      // Les journées déjà écrites référencent l’ancien id : on retire la ligne
      // morte, le stock du doublon étant nul (seul `to` porte du stock AquaPro).
      for (const col of ["zogbo_jours", "gbegamey_jours"]) {
        await db.collection(col).updateMany({}, { $pull: { lines: { productId: from } } });
        await db
          .collection(col)
          .updateMany({}, { $pull: { transferLines: { productId: from } } });
      }
    }
    catalog.delete(from);
    merges.push({ from, to, ventesReportees: ventes });
  }
  report.fusions = merges;

  // ——— 2. Combos manquants au catalogue ———
  const existingCombos = new Map((parametres.combos || []).map((c) => [c.id, c]));
  const newCombos = [];
  for (const c of COMBOS_SOLD_ZOGBO) {
    const cid = comboId(c.name);
    if (existingCombos.has(cid)) continue;
    newCombos.push({
      id: cid,
      name: c.name,
      unitPrice: c.unitPrice,
      baseDishName: c.base ? resolve(c.base).name : null,
    });
  }
  if (newCombos.length && !dryRun) {
    await db
      .collection("parametres")
      .updateOne({ _id: "parametres" }, { $push: { combos: { $each: newCombos } } });
  }
  report.combosAjoutes = newCombos.map((c) => c.name);

  // ——— 3. Zogbo : préparations, envois, comptage ———
  // Attasi est un plat local côté AquaPro : son flux Zogbo → Gbégamey n’a pas
  // de représentation dans le modèle. Seules ses ventes Zogbo sont conservées.
  const zogboRows = ZOGBO.filter((r) => resolve(r.name).kind === "plat");
  const zogboHorsModele = ZOGBO.filter((r) => resolve(r.name).kind !== "plat").map(
    (r) => r.name,
  );

  const movements = [];
  let prepMin = 0;
  let sendMin = 0;
  const zogboById = new Map();

  for (const [idx, row] of zogboRows.entries()) {
    const { id: productId, name } = resolve(row.name);
    const prepared = Math.max(row.prepared, row.sent);
    const stock = Math.max(0, prepared - row.sent);

    movements.push({
      id: newId(),
      at: at(7, prepMin % 60, idx),
      type: "prepare",
      productId,
      name,
      qty: prepared,
      stockAfter: prepared,
      cancelledAt: null,
    });
    prepMin += 4;

    if (row.sent > 0) {
      movements.push({
        id: newId(),
        at: at(9, sendMin % 60, idx),
        type: "send",
        productId,
        name,
        qty: row.sent,
        stockAfter: stock,
        cancelledAt: null,
      });
      sendMin += 3;
    }

    zogboById.set(productId, {
      productId,
      name,
      stock,
      prepared,
      sentToGbegamey: row.sent,
      sold: row.sold,
      counted: row.counted,
      observations: OBS,
    });
  }
  movements.sort((a, b) => a.at.localeCompare(b.at));

  // Les plats du catalogue absents de l’inventaire ouvrent la journée à zéro.
  const zogboLines = (parametres.baseDishes || [])
    .filter((d) => catalog.has(d.id))
    .map(
      (d) =>
        zogboById.get(d.id) ?? {
          productId: d.id,
          name: d.name,
          stock: 0,
          prepared: 0,
          sentToGbegamey: 0,
          sold: 0,
          counted: null,
          observations: "",
        },
    );

  if (!dryRun) {
    await db.collection("zogbo_jours").replaceOne(
      { _id: DATE },
      {
        _id: DATE,
        status: "cloturee",
        lines: zogboLines,
        movements,
        updatedAt: now,
        source: "inventaire-marco",
        rev: 1,
      },
      { upsert: true },
    );
  }
  report.zogbo = {
    lignes: zogboLines.length,
    renseignees: zogboById.size,
    mouvements: movements.length,
    horsModele: zogboHorsModele,
  };

  // ——— 4. Gbégamey : reçus + plats locaux ———
  const transferById = new Map();
  for (const row of GBEGAMEY_TRANSFER) {
    const { id: productId, kind, name } = resolve(row.name);
    if (kind !== "plat") continue;
    transferById.set(productId, {
      productId,
      name,
      initialStock: 0,
      received: row.received,
      sold: row.sold,
      counted: row.counted,
      observations: OBS,
    });
  }
  const transferLines = (parametres.baseDishes || [])
    .filter((d) => catalog.has(d.id))
    .map(
      (d) =>
        transferById.get(d.id) ?? {
          productId: d.id,
          name: d.name,
          initialStock: 0,
          received: 0,
          sold: 0,
          counted: null,
          observations: "",
        },
    );

  const localById = new Map();
  for (const row of GBEGAMEY_LOCAL) {
    const { id: productId, name } = resolve(row.name);
    localById.set(productId, {
      productId,
      name,
      initialStock: 0,
      prepared: row.prepared,
      sold: row.sold,
      counted: row.counted,
      observations: OBS,
    });
  }
  // Attasi : plat local vendu à Gbégamey, ses quantités viennent de la feuille
  // Gbégamey (45 reçus traités comme préparés sur place, 10 vendus, 31 comptés).
  for (const row of GBEGAMEY_TRANSFER) {
    const { id: productId, kind, name } = resolve(row.name);
    if (kind !== "local") continue;
    localById.set(productId, {
      productId,
      name,
      initialStock: 0,
      prepared: row.received,
      sold: row.sold,
      counted: row.counted,
      observations: `${OBS} — reçu de Zogbo`,
    });
  }
  const localLines = (parametres.localDishes || []).map(
    (d) =>
      localById.get(d.id) ?? {
        productId: d.id,
        name: d.name,
        initialStock: 0,
        prepared: 0,
        sold: 0,
        counted: null,
        observations: "",
      },
  );

  if (!dryRun) {
    await db.collection("gbegamey_jours").replaceOne(
      { _id: DATE },
      {
        _id: DATE,
        status: "cloturee",
        transferLines,
        localLines,
        movements: [],
        updatedAt: now,
        source: "inventaire-marco",
        rev: 1,
      },
      { upsert: true },
    );
  }
  report.gbegamey = {
    transferts: transferLines.length,
    transfertsRenseignes: transferById.size,
    locaux: localLines.length,
    locauxRenseignes: localById.size,
  };

  // ——— 5. Combos vendus à Zogbo ———
  const allCombos = [...(parametres.combos || []), ...newCombos];
  const soldByComboId = new Map(
    COMBOS_SOLD_ZOGBO.map((c) => [comboId(c.name), c.qty]),
  );
  const comboLines = allCombos.map((c) => {
    const sold = soldByComboId.get(c.id) ?? 0;
    return {
      productId: c.id,
      name: c.name,
      baseDishName: c.baseDishName ?? null,
      stockZogbo: 0,
      prepared: sold,
      sentToGbegamey: 0,
      soldZogbo: sold,
      countedZogbo: 0,
      initialGbegamey: 0,
      soldGbegamey: 0,
      countedGbegamey: null,
      observations: sold > 0 ? OBS : "",
    };
  });
  if (!dryRun) {
    await db.collection("combos_jours").replaceOne(
      { _id: DATE },
      {
        _id: DATE,
        status: "cloturee",
        lines: comboLines,
        movements: [],
        updatedAt: now,
        source: "inventaire-marco",
        rev: 1,
      },
      { upsert: true },
    );
  }
  report.combos = { lignes: comboLines.length, vendus: soldByComboId.size };

  // ——— 6. Ventes de Zogbo uniquement ———
  // AquaPro ne couvre que Gbégamey : ses 07/08 restent intacts. Les ventes de
  // Zogbo, elles, n’existent nulle part ailleurs que dans cet inventaire.
  const dejaImportees = await db
    .collection("ventes_log")
    .countDocuments({ date: DATE, source: "inventaire-marco" });
  if (!dryRun && dejaImportees) {
    await db
      .collection("ventes_log")
      .deleteMany({ date: DATE, source: "inventaire-marco" });
  }

  const ventes = [];
  let vh = 10;
  let vm = 0;
  const nextAt = () => {
    const t = at(vh, vm, 0);
    vm += 7;
    if (vm >= 60) {
      vm = 0;
      vh += 1;
    }
    if (vh > 21) vh = 12;
    return t;
  };

  for (const row of ZOGBO) {
    if (row.sold <= 0) continue;
    const { id: productId, kind, name } = resolve(row.name);
    ventes.push({
      _id: new ObjectId(),
      date: DATE,
      site: "zogbo",
      kind,
      productId,
      name,
      qty: row.sold,
      unitPrice: 1500,
      costPrice: 0,
      amount: row.sold * 1500,
      at: nextAt(),
      cancelledAt: null,
      caExcluded: false,
      source: "inventaire-marco",
    });
  }

  for (const c of COMBOS_SOLD_ZOGBO) {
    if (c.qty <= 0) continue;
    ventes.push({
      _id: new ObjectId(),
      date: DATE,
      site: "zogbo",
      kind: "combo",
      productId: comboId(c.name),
      name: c.name,
      qty: c.qty,
      unitPrice: c.unitPrice,
      costPrice: 0,
      amount: c.qty * c.unitPrice,
      at: nextAt(),
      cancelledAt: null,
      caExcluded: false,
      source: "inventaire-marco",
    });
  }

  ventes.sort((a, b) => a.at.localeCompare(b.at));
  if (ventes.length && !dryRun) await db.collection("ventes_log").insertMany(ventes);

  // Recoupement avec la ligne TOTAL de la feuille : un écart signale une erreur
  // de correspondance ou une ligne oubliée.
  const caPlats = ventes
    .filter((v) => v.kind !== "combo")
    .reduce((s, v) => s + v.amount, 0);
  const platsVendus = ventes
    .filter((v) => v.kind !== "combo")
    .reduce((s, v) => s + v.qty, 0);
  const caCombos = ventes
    .filter((v) => v.kind === "combo")
    .reduce((s, v) => s + v.amount, 0);
  report.controle = {
    platsVendus: `${platsVendus} / ${CONTROLE.platsVendus}`,
    caPlats: `${caPlats} / ${CONTROLE.caPlats}`,
    caCombos: `${caCombos} / ${CONTROLE.caCombos}`,
    ok:
      platsVendus === CONTROLE.platsVendus &&
      caPlats === CONTROLE.caPlats &&
      caCombos === CONTROLE.caCombos,
  };

  const caZogbo = ventes.reduce((s, v) => s + v.amount, 0);
  const aquapro = await db
    .collection("ventes_log")
    .aggregate([
      { $match: { date: DATE, source: "aquapro" } },
      { $group: { _id: null, n: { $sum: 1 }, ca: { $sum: "$amount" } } },
    ])
    .toArray();
  report.ventes = {
    zogboAjoutees: ventes.length,
    caZogbo,
    aquaproConservees: aquapro[0]?.n ?? 0,
    caAquapro: aquapro[0]?.ca ?? 0,
  };

  // ——— 7. Historique ———
  if (!dryRun) {
    await db
      .collection("historique")
      .deleteMany({ date: DATE, detail: { $regex: /marco/i } });
    await db.collection("historique").insertMany([
      {
        _id: new ObjectId(),
        at: at(7, 0),
        date: DATE,
        kind: "zogbo",
        site: "zogbo",
        title: "Import inventaire Zogbo",
        detail: `Inventaire marco.xlsx · ${movements.filter((m) => m.type === "prepare").length} préparations`,
        actorId: null,
        actorName: "Import Excel",
        amount: null,
      },
      {
        _id: new ObjectId(),
        at: at(9, 0),
        date: DATE,
        kind: "transfert",
        site: "zogbo",
        title: "Envois Zogbo → Gbégamey",
        detail: `Inventaire marco.xlsx · ${movements.filter((m) => m.type === "send").length} envois`,
        actorId: null,
        actorName: "Import Excel",
        amount: null,
      },
      {
        _id: new ObjectId(),
        at: at(22, 0),
        date: DATE,
        kind: "gbegamey",
        site: "gbegamey",
        title: "Clôture inventaire Gbégamey",
        detail: "Inventaire marco.xlsx · stocks comptés au 07/08/2026",
        actorId: null,
        actorName: "Import Excel",
        amount: null,
      },
    ]);
  }

  console.log(JSON.stringify(report, null, 2));
  await client.close();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
