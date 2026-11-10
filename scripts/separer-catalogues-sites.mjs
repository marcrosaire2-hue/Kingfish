/**
 * Donne à Zogbo et à Gbégamey chacun leur propre catalogue de vente, à partir
 * des listes communes actuelles, puis rend à Gbégamey sa fiche FIFA PB
 * (24 bouteilles par casier), renommée AQUABELLE depuis Zogbo le 07/11/2026.
 *
 * Ne touche que le document `parametres` : ni ventes, ni stocks, ni journées.
 * Une sauvegarde est écrite d'abord, et le script refuse de s'exécuter deux fois.
 *
 * Usage :
 *   node --env-file=.env.local scripts/separer-catalogues-sites.mjs --dry-run
 *   FIFA_PB_PRIX_VENTE=300 FIFA_PB_PRIX_ACHAT=185 \
 *     node --env-file=.env.local scripts/separer-catalogues-sites.mjs --yes
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MongoClient } from "mongodb";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
if (!dryRun && !args.has("--yes")) {
  console.error("Refus : passez --yes pour écrire, ou --dry-run pour simuler.");
  process.exit(1);
}

const prixVente = Number(process.env.FIFA_PB_PRIX_VENTE);
const prixAchat = Number(process.env.FIFA_PB_PRIX_ACHAT);
const prixFournis = prixVente > 0 && prixAchat >= 0 && process.env.FIFA_PB_PRIX_ACHAT;
if (!dryRun && !prixFournis) {
  console.error("Refus : indiquez FIFA_PB_PRIX_VENTE et FIFA_PB_PRIX_ACHAT.");
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");
const col = db.collection("parametres");
const doc = await col.findOne({ _id: "parametres" });
if (!doc) throw new Error("Document parametres introuvable.");
if (doc.catalogues) {
  console.error("Les catalogues sont déjà séparés : rien à faire.");
  await client.close();
  process.exit(1);
}

const copie = () =>
  structuredClone({
    baseDishes: doc.baseDishes ?? [],
    drinks: doc.drinks ?? [],
    localDishes: doc.localDishes ?? [],
    combos: doc.combos ?? [],
    categories: doc.categories ?? [],
    categoryProducts: doc.categoryProducts ?? [],
    rawMaterials: doc.rawMaterials ?? [],
    recipes: doc.recipes ?? [],
    updatedAt: new Date().toISOString(),
  });
const zogbo = copie();
const gbegamey = copie();

const fifa = gbegamey.drinks.find((d) => d.id === "drink-fifa-pb");
if (!fifa) throw new Error("Fiche drink-fifa-pb introuvable.");
console.log(`Gbégamey, avant : ${fifa.name.trim()} · ${fifa.unitsPerCasier}/casier · achat ${fifa.purchasePrice} · vente ${fifa.salePrice}`);
fifa.name = "FIFA PB";
fifa.unitsPerCasier = 24;
if (prixFournis) {
  fifa.salePrice = prixVente;
  fifa.purchasePrice = prixAchat;
}
console.log(`Gbégamey, après : FIFA PB · 24/casier · achat ${fifa.purchasePrice} · vente ${fifa.salePrice}${prixFournis ? "" : " (prix à fournir)"}`);
console.log(`Zogbo, inchangé : ${zogbo.drinks.find((d) => d.id === "drink-fifa-pb").name.trim()}`);
console.log(`Listes copiées par site : plats ${zogbo.baseDishes.length}, boissons ${zogbo.drinks.length}, accompagnements ${zogbo.localDishes.length}, formules ${zogbo.combos.length}, articles de catégories ${zogbo.categoryProducts.length}`);

// Autres produits renommés depuis le 06/11, à vérifier site par site.
const avant = await db.collection("boissons_jours").findOne({ _id: "2026-11-06" });
const avantG = await db.collection("gbegamey_jours").findOne({ _id: "2026-11-06" });
const comparer = (libelle, lignes, liste) => {
  for (const l of lignes ?? []) {
    const p = liste.find((x) => x.id === l.productId);
    if (p && p.name.trim() !== String(l.name).trim()) {
      console.log(`À vérifier (${libelle}) : « ${String(l.name).trim()} » est devenu « ${p.name.trim()} »`);
    }
  }
};
comparer("boisson", avant?.lines, doc.drinks ?? []);
comparer("plat", avantG?.transferLines, doc.baseDishes ?? []);
comparer("accompagnement", avantG?.localLines, doc.localDishes ?? []);

if (dryRun) {
  console.log("Simulation : rien n'a été écrit.");
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(process.cwd(), "sauvegardes", `avant-separation-catalogues-${stamp}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "parametres.json"), JSON.stringify(doc, null, 2));
  console.log(`Sauvegarde : ${dir}`);
  const res = await col.updateOne(
    { _id: "parametres", catalogues: { $exists: false } },
    { $set: { catalogues: { zogbo, gbegamey } } },
  );
  if (res.modifiedCount !== 1) throw new Error("Écriture non appliquée.");
  console.log("Catalogues séparés.");
}
await client.close();
