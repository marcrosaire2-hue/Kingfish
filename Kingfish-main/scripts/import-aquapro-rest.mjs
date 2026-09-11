/**
 * Importe le reste des dumps AquaPro manquants dans King Fish (Mongo).
 * - inventaires boissons (+ lignes)
 * - approvisionnements (+ lignes)
 * - caisses (tous utilisateurs)
 * - aliments sources
 * - config entreprise → pos_config
 * - stats ventes de référence
 *
 * Idempotent (replace collections aquapro_* concernées).
 *
 * Usage: node --env-file=.env.local scripts/import-aquapro-rest.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXPORT = path.join(ROOT, "data/aquapro-export");

async function readJson(name) {
  try {
    return JSON.parse(await fs.readFile(path.join(EXPORT, name), "utf8"));
  } catch {
    return null;
  }
}

function resultOf(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.Result)) return payload.Result;
  return [];
}

function portoDate(iso) {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Porto-Novo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function normKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "gestion_restaurant";
  if (!uri) throw new Error("MONGODB_URI manquant");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const now = new Date().toISOString();
  const summary = {};

  // —— Aliments sources ——
  const alimentsRaw =
    resultOf(await readJson("produit_liste2.json")) ||
    resultOf(await readJson("produit_liste_all.json"));
  const aliments = alimentsRaw.map((a) => ({
    _id: `aqua-aliment-${a.id}`,
    aquaId: a.id,
    designation: String(a.designation || "").trim(),
    unite: a.unite || null,
    seuil: Number(a.seuil) || 0,
    stock: Number(a.stock) || 0,
    stockFranc: Number(a.stock_franc) || 0,
    stockBloquant: a.stock_bloquant || "Non",
    puisable: a.puisable_en_portion || "Non",
    contenance: a.contenance ?? null,
    prixReference: Number(a.prix_reference) || 0,
    createdAt: a.createdAt || null,
    updatedAt: a.updatedAt || null,
    source: "aquapro",
  }));
  await db.collection("aquapro_aliments_sources").deleteMany({});
  if (aliments.length) await db.collection("aquapro_aliments_sources").insertMany(aliments);
  summary.alimentsSources = aliments.length;

  // —— Inventaires boissons ——
  const invLignes = (await readJson("inventaireboisson_lignes.json")) || [];
  const inventaires = invLignes.map((row) => {
    const h = row.header || {};
    const lines = resultOf(row.data);
    return {
      _id: `aqua-invb-${row.id ?? h.id}`,
      aquaId: row.id ?? h.id,
      date: portoDate(h.date || h.createdAt),
      at: h.date || h.createdAt || null,
      statut: h.statut || null,
      userid: h.userid ?? null,
      lignes: lines.map((l) => ({
        aquaLigneId: l.id,
        produitId: l.produit_id,
        designation: String(l.designation || "").trim(),
        quantite: Number(l.quantite) || 0,
        quantiteTheorique: Number(l.quantite_theorique) || 0,
        ecart: Number(l.ecart) || 0,
        valeurEcart: Number(l.valeur_ecart) || 0,
      })),
      source: "aquapro",
    };
  });
  await db.collection("aquapro_inventaires_boisson").deleteMany({});
  if (inventaires.length) {
    await db.collection("aquapro_inventaires_boisson").insertMany(inventaires);
  }
  summary.inventairesBoisson = inventaires.length;
  summary.inventaireLignes = inventaires.reduce((n, i) => n + i.lignes.length, 0);

  // —— Appros ——
  const approLignes = (await readJson("appro_lignes.json")) || [];
  const appros = approLignes.map((row) => {
    const h = row.header || {};
    const lines = resultOf(row.data);
    return {
      _id: `aqua-appro-${row.id ?? h.id}`,
      aquaId: row.id ?? h.id,
      numero: h.numero || null,
      date: portoDate(h.date || h.createdAt),
      at: h.date || h.createdAt || null,
      statut: h.statut || null,
      montant: Number(h.montant) || 0,
      userid: h.userid ?? null,
      lignes: lines.map((l) => ({
        aquaLigneId: l.id,
        produitId: l.produit_id,
        designation: String(l.designation || "").trim(),
        quantite: Number(l.quantite) || 0,
        prixUnitaire: Number(l.prix_unitaire) || 0,
        montant: Number(l.montligne) || 0,
        unite: l.unite || null,
      })),
      source: "aquapro",
    };
  });
  await db.collection("aquapro_appros").deleteMany({});
  if (appros.length) await db.collection("aquapro_appros").insertMany(appros);
  summary.appros = appros.length;
  summary.approLignes = appros.reduce((n, a) => n + a.lignes.length, 0);

  // —— Caisses ——
  const caissesByUser = (await readJson("caisses_par_utilisateur.json")) || [];
  const caisses = [];
  for (const block of caissesByUser) {
    const user = block.user || {};
    for (const c of block.caisses || []) {
      caisses.push({
        _id: `aqua-caisse-${c.id}`,
        aquaId: c.id,
        numero: c.numero_caisse || null,
        userid: c.userid ?? user.id ?? null,
        caissier: user.nom || null,
        role: user.role || null,
        dateOuverture: c.date_ouverture || null,
        heureOuverture: c.heure_ouverture || null,
        dateFermeture: c.date_fermeture || null,
        heureFermeture: c.heure_fermeture || null,
        soldeInitial: Number(c.solde_initial) || 0,
        totalEntree: Number(c.total_entree) || 0,
        totalSortie: Number(c.total_sortie) || 0,
        totalRecette: Number(c.total_recette) || 0,
        totalVente: Number(c.total_vente) || 0,
        soldePhysique:
          c.solde_physique == null ? null : Number(c.solde_physique),
        soldeFermeture:
          c.solde_fermeture == null ? null : Number(c.solde_fermeture),
        statut: c.statut || null,
        commentaire: c.commentaire || null,
        createdAt: c.createdAt || null,
        updatedAt: c.updatedAt || null,
        source: "aquapro",
      });
    }
  }
  await db.collection("aquapro_caisses").deleteMany({});
  if (caisses.length) await db.collection("aquapro_caisses").insertMany(caisses);
  summary.caisses = caisses.length;

  // —— Stats référence ——
  const stats = {
    _id: "aquapro_stats",
    ventesParJour: await readJson("vente_ventes-par-jour.json"),
    ventesParMois: await readJson("vente_ventes-par-mois.json"),
    statsMensuelles: await readJson("vente_stats-ventes-mensuelles.json"),
    comparatifMensuel: await readJson("vente_comparatif-mensuel.json"),
    hebdomadaire: await readJson("vente_vente-hebdomadaire.json"),
    updatedAt: now,
  };
  await db.collection("aquapro_stats").updateOne(
    { _id: "aquapro_stats" },
    { $set: stats },
    { upsert: true },
  );
  summary.stats = true;

  // —— Config entreprise → pos_config ——
  const configPayload = await readJson("config_liste.json");
  const company = configPayload?.Result || null;
  if (company && typeof company === "object") {
    await db.collection("pos_config").updateOne(
      { _id: "pos_config" },
      {
        $set: {
          company: {
            nom: company.nom_entreprise || null,
            contacts: company.contacts || null,
            adresse: company.adresse || null,
            activites: company.activites || null,
            logo: company.logo || null,
          },
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    summary.company = company.nom_entreprise || true;
  }

  // —— Projeter inventaires boissons → boissons_jours.counted (casiers) ——
  const draft = await readJson("kingfish-parametres-draft.json");
  const drinkByName = new Map();
  for (const d of draft?.drinks || []) {
    drinkByName.set(normKey(d.name), d);
  }

  let boissonsDays = 0;
  let countedLines = 0;
  for (const inv of inventaires) {
    if (!inv.date || inv.statut !== "Validé") continue;
    if (!inv.lignes.length) continue;

    const linesById = new Map();
    for (const l of inv.lignes) {
      const drink = drinkByName.get(normKey(l.designation));
      if (!drink) continue;
      const upc = Math.max(1, Number(drink.unitsPerCasier) || 12);
      // AquaPro stocke souvent des bouteilles → King Fish compte en casiers
      const bottles = Number(l.quantite) || 0;
      const casiers = Math.round((bottles / upc) * 1000) / 1000;
      linesById.set(drink.id, {
        productId: drink.id,
        name: drink.name,
        counted: casiers,
        observations: `AquaPro inventaire #${inv.aquaId} (${bottles} bt)`,
      });
      countedLines++;
    }
    if (!linesById.size) continue;

    const existing = await db.collection("boissons_jours").findOne({
      _id: inv.date,
    });
    const drinks = draft.drinks || [];
    const merged = drinks.map((d) => {
      const fromInv = linesById.get(d.id);
      const prev = existing?.lines?.find((x) => x.productId === d.id);
      return {
        productId: d.id,
        name: d.name,
        initialStock: prev?.initialStock ?? 0,
        purchases: prev?.purchases ?? 0,
        soldZogbo: prev?.soldZogbo ?? 0,
        soldGbegamey: prev?.soldGbegamey ?? 0,
        counted: fromInv ? fromInv.counted : (prev?.counted ?? null),
        observations: fromInv?.observations || prev?.observations || "",
      };
    });

    await db.collection("boissons_jours").updateOne(
      { _id: inv.date },
      {
        $set: {
          status: existing?.status || "ouverte",
          lines: merged,
          movements: existing?.movements || [],
          updatedAt: now,
          source: "aquapro-inventaire",
        },
      },
      { upsert: true },
    );
    boissonsDays++;
  }
  summary.boissonsJours = boissonsDays;
  summary.boissonsCountedLines = countedLines;

  await db.collection("aquapro_import").updateOne(
    { _id: "latest" },
    { $set: { restImportedAt: now, rest: summary } },
    { upsert: true },
  );

  await client.close();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
