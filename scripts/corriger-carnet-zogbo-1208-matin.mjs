#!/usr/bin/env node
/**
 * Corrige le carnet du matin Zogbo du 12/08/2026 (source carnet-zogbo-1208-matin).
 *
 * Les 5 lignes boissons (4 350 F) étaient déjà correctes — reprises telles
 * quelles. Il manquait un plat : 1 Atassi à 1 500 F, absent du premier
 * import (« Aucune nourriture dans ce ticket »). Total matin après
 * correction : 4 350 + 1 500 = 5 850 F, conforme au récapitulatif transmis.
 *
 * Choix retenu pour « Atassi » : le seul produit de ce nom au catalogue est
 * l'accompagnement `local-atassi` (kind=local) — la feuille papier range ce
 * plat sous un intitulé générique « Plats » (nourriture vs boissons), pas
 * selon le découpage plat/accompagnement du système. Prix ticket conservé
 * tel quel (1 500 F), au-dessus du prix catalogue (500 F) — écart signalé,
 * pas corrigé.
 *
 * Comme le carnet du soir : aucune écriture de stock
 * (zogbo_jours/boissons_jours), la donnée est le CA du journal seulement.
 *
 * Usage:
 *   node --env-file=.env.local scripts/corriger-carnet-zogbo-1208-matin.mjs --dry-run
 *   node --env-file=.env.local scripts/corriger-carnet-zogbo-1208-matin.mjs --yes
 */
import { MongoClient, ObjectId } from "mongodb";

const DATE = "2026-08-12";
const SITE = "zogbo";
const SOURCE = "carnet-zogbo-1208-matin";
const EXPECTED_TOTAL = 5850;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}

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
  if (!(parametres?.localDishes ?? []).some((d) => d.id === "local-atassi")) {
    throw new Error("local-atassi introuvable dans parametres.");
  }

  // Boissons reprises telles quelles, nouvel _id (l'original sera supprimé).
  const ventes = existants.map((doc) => ({ ...doc, _id: new ObjectId() }));

  const dernier = existants[existants.length - 1];
  const heureAtassi = new Date(dernier.at);
  heureAtassi.setMinutes(heureAtassi.getMinutes() + 5);

  ventes.push({
    _id: new ObjectId(),
    date: DATE,
    site: SITE,
    kind: "local",
    productId: "local-atassi",
    name: "ATASSI",
    qty: 1,
    unitPrice: 1500,
    costPrice: 0,
    amount: 1500,
    at: heureAtassi.toISOString(),
    cancelledAt: null,
    caExcluded: false,
    shift: "matin",
    source: SOURCE,
  });

  const ca = ventes.reduce((s, v) => s + v.amount, 0);

  console.log(
    JSON.stringify(
      {
        dryRun,
        date: DATE,
        site: SITE,
        source: SOURCE,
        lignesAvant: existants.length,
        lignesApres: ventes.length,
        caAvant: existants.reduce((s, v) => s + v.amount, 0),
        caApres: ca,
        conformeRecap: ca === EXPECTED_TOTAL,
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    await client.close();
    return;
  }

  if (ca !== EXPECTED_TOTAL) {
    throw new Error(`CA final ${ca} ≠ récapitulatif attendu ${EXPECTED_TOTAL} — arrêt.`);
  }

  await db.collection("ventes_log").deleteMany({ date: DATE, site: SITE, source: SOURCE });
  await db.collection("ventes_log").insertMany(ventes);

  console.log(`Corrigé : ${ventes.length} lignes en base (dont 1 nouvelle).`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
