#!/usr/bin/env node
/**
 * Corrige le carnet du soir Zogbo du 12/08/2026 (source carnet-zogbo-1208-soir).
 *
 * Les 29 lignes boissons sont déjà correctement classées (productId réel,
 * prix du ticket conservé même quand il diffère du catalogue) : reprises
 * telles quelles.
 *
 * Les 4 lignes « Plat X + Y » étaient enregistrées en kind=extra, un seul
 * bloc à 1500 F — invisibles dans le CA par produit, la répartition
 * plats/accompagnements, et le stock plats. Remplacées par deux lignes
 * réelles (plat + accompagnement), comme le fait le composeur de la page
 * Vente. Aucune écriture de stock (zogbo_jours/boissons_jours) : demande
 * explicite, comme les imports carnet précédents.
 *
 * Deux choix incertains, faute de mieux sur la feuille papier :
 *   - « sauce légumes » → SAUCE LEGUMES TCHIAYO GBOMAN (l'autre variante du
 *     catalogue, AMANVIVE+TCHIAYO, est aussi possible)
 *   - Aucun autre — « Wold Cola », « Sprite », « Yoyo » gardent le mapping
 *     déjà en base (cohérent avec le raisonnement indépendant refait ici).
 *
 * Usage:
 *   node --env-file=.env.local scripts/corriger-carnet-zogbo-1208-soir.mjs --dry-run
 *   node --env-file=.env.local scripts/corriger-carnet-zogbo-1208-soir.mjs --yes
 */
import { MongoClient, ObjectId } from "mongodb";

const DATE = "2026-08-12";
const SITE = "zogbo";
const SOURCE = "carnet-zogbo-1208-soir";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}

/** Chaque ligne « extra » à décomposer → [plat, accompagnement]. */
const SPLITS = {
  "extra-plat-telibo-sauce-legumes": [
    {
      kind: "plat",
      productId: "base-sauce-legumes-tchiayo-gboman",
      name: "SAUCE LEGUMES TCHIAYO GBOMAN",
      unitPrice: 1000,
    },
    { kind: "local", productId: "local-telibo", name: "TELIBO", unitPrice: 500 },
  ],
  "extra-plat-chekouya-riz": [
    { kind: "plat", productId: "base-choukouya", name: "CHOUKOUYA", unitPrice: 1000 },
    { kind: "local", productId: "local-riz", name: "RIZ", unitPrice: 500 },
  ],
  "extra-plat-brochette-frite": [
    {
      kind: "plat",
      productId: "base-brochette-de-poisson",
      name: "BROCHETTE DE POISSON",
      unitPrice: 1000,
    },
    { kind: "local", productId: "local-frites", name: "FRITES", unitPrice: 500 },
  ],
};

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");

  const existants = await db
    .collection("ventes_log")
    .find({ date: DATE, site: SITE, source: SOURCE })
    .sort({ at: 1 })
    .toArray();

  if (!existants.length) {
    throw new Error(`Aucune ligne ${SOURCE} trouvée pour ${DATE} — rien à corriger.`);
  }

  const parametres = await db.collection("parametres").findOne({ _id: "parametres" });
  const platIds = new Set((parametres?.baseDishes ?? []).map((d) => d.id));
  const localIds = new Set((parametres?.localDishes ?? []).map((d) => d.id));
  for (const lignes of Object.values(SPLITS)) {
    for (const l of lignes) {
      const ids = l.kind === "plat" ? platIds : localIds;
      if (!ids.has(l.productId)) {
        throw new Error(`Produit introuvable dans parametres : ${l.productId}`);
      }
    }
  }

  const ventes = [];
  let corrigees = 0;
  for (const doc of existants) {
    const split = SPLITS[doc.productId];
    if (doc.kind === "extra" && split) {
      corrigees += 1;
      for (const l of split) {
        ventes.push({
          _id: new ObjectId(),
          date: DATE,
          site: SITE,
          kind: l.kind,
          productId: l.productId,
          name: l.name,
          qty: doc.qty,
          unitPrice: l.unitPrice,
          costPrice: 0,
          amount: doc.qty * l.unitPrice,
          at: doc.at,
          cancelledAt: null,
          caExcluded: false,
          shift: doc.shift,
          source: SOURCE,
        });
      }
      continue;
    }
    // Ligne déjà correcte : reprise à l'identique (nouvel _id, le
    // document d'origine sera supprimé avant réinsertion).
    ventes.push({ ...doc, _id: new ObjectId() });
  }

  const ca = ventes.reduce((s, v) => s + v.amount, 0);
  const caAvant = existants.reduce((s, v) => s + v.amount, 0);

  console.log(
    JSON.stringify(
      {
        dryRun,
        date: DATE,
        site: SITE,
        source: SOURCE,
        lignesAvant: existants.length,
        lignesApres: ventes.length,
        lignesCorrigees: corrigees,
        caAvant,
        caApres: ca,
        ecartCa: ca - caAvant,
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    await client.close();
    return;
  }

  if (ca !== caAvant) {
    throw new Error(`CA modifié par la correction (${caAvant} → ${ca}) — arrêt.`);
  }

  await db.collection("ventes_log").deleteMany({ date: DATE, site: SITE, source: SOURCE });
  await db.collection("ventes_log").insertMany(ventes);

  console.log(`Corrigé : ${corrigees} ligne(s) décomposée(s), ${ventes.length} lignes en base.`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
