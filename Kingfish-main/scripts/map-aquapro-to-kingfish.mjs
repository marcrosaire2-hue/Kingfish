#!/usr/bin/env node
/**
 * Transforme data/aquapro-export → mapping King Fish (paramètres + config POS).
 * Ne touche pas MongoDB — écrit seulement des JSON d’intégration.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, "../data/aquapro-export");

function cleanName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normKey(name) {
  return cleanName(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function id(prefix, name) {
  return `${prefix}-${normKey(name).replace(/\s+/g, "-")}`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Garde le premier, ou remplace si le nouveau a un prix plus utile */
function dedupeByName(items, priceKey = "unitPrice") {
  const map = new Map();
  for (const item of items) {
    const key = normKey(item.name);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, item);
      continue;
    }
    const prevPrice = num(prev[priceKey] ?? prev.salePrice);
    const nextPrice = num(item[priceKey] ?? item.salePrice);
    if (nextPrice > prevPrice) map.set(key, item);
  }
  return [...map.values()];
}

function unitsPerCasier(name) {
  const n = String(name).toUpperCase();
  if (/\bPB\b|\bPM\b|\bGM\b/.test(n)) return 24;
  if (/\bGB\b/.test(n)) return 12;
  return 24;
}

async function readResult(file) {
  try {
    const j = JSON.parse(await fs.readFile(path.join(DIR, file), "utf8"));
    if (Array.isArray(j)) return j;
    if (Array.isArray(j.Result)) return j.Result;
    if (Array.isArray(j.items)) return j.items;
    return [];
  } catch {
    return [];
  }
}

async function main() {
  const produits = await readResult("uniteconversion_liste2.json");
  const aliments = await readResult("produit_liste2.json");
  const categories = await readResult("categorie_liste2.json");
  const paiements = await readResult("moyenpaiement_liste.json");
  const tables = await readResult("table_liste.json");
  const users = await readResult("auth_liste.json");
  const serveurs = await readResult("auth_listeserveur.json");
  const unites = await readResult("unitemesure_liste.json");
  const inventairesBoisson = await readResult("inventaireboisson_liste.json");
  const appros = await readResult("appro_liste.json");

  const plats = produits.filter((p) => String(p.type).toLowerCase() === "plat");
  const boissons = produits.filter(
    (p) => String(p.type).toLowerCase() === "boisson",
  );

  // Heuristique King Fish :
  // - PLATS / BURGER → baseDishes (plats de production Zogbo)
  // - ACCOMPAGNEMENTS → localDishes (Gbégamey)
  // - boissons → drinks
  const localCats = new Set(["ACCOMPAGNEMENTS"]);

  const baseDishesRaw = [];
  const localDishesRaw = [];
  for (const p of plats) {
    const name = cleanName(p.designation);
    if (!name) continue;
    const dish = {
      id: id("base", name),
      name,
      unitPrice: num(p.prix),
      aquaId: p.id,
      categorie: p.libelle || null,
      prixRevient: num(p.prix_revient),
    };
    if (localCats.has(String(p.libelle || "").toUpperCase())) {
      localDishesRaw.push({ ...dish, id: id("local", name) });
    } else {
      // PLATS / BURGER / défaut → base (Zogbo)
      baseDishesRaw.push(dish);
    }
  }

  const drinksRaw = boissons
    .map((p) => {
      const name = cleanName(p.designation);
      if (!name) return null;
      return {
        id: id("drink", name),
        name,
        purchasePrice: num(p.prix_revient),
        salePrice: num(p.prix) || null,
        unitsPerCasier: unitsPerCasier(name),
        aquaId: p.id,
        categorie: p.libelle || null,
        stockAqua: p.stock ?? null,
      };
    })
    .filter(Boolean);

  const baseDishes = dedupeByName(baseDishesRaw);
  const localDishes = dedupeByName(localDishesRaw);
  const drinks = dedupeByName(drinksRaw, "salePrice");

  const parametresDraft = {
    source: "aquapro",
    extractedAt: new Date().toISOString(),
    note: "Catalogue AquaPro intégré dans King Fish Manager.",
    baseDishes: baseDishes.map(({ aquaId, categorie, prixRevient, ...rest }) => rest),
    combos: [],
    drinks: drinks.map(({ aquaId, categorie, stockAqua, ...rest }) => rest),
    localDishes: localDishes.map(
      ({ aquaId, categorie, prixRevient, ...rest }) => rest,
    ),
    updatedAt: new Date().toISOString(),
  };

  const posConfig = {
    source: "aquapro",
    categories: categories.map((c) => ({
      id: c.id,
      libelle: c.libelle,
    })),
    paymentMethods: paiements.map((p) => ({
      id: p.id,
      libelle: p.libelle,
    })),
    tables: tables.map((t) => ({
      id: t.id,
      reference: t.reference,
      emplacement: t.emplacement,
    })),
    units: unites.map((u) => ({ id: u.id, libelle: u.libelle })),
    users: users.map((u) => ({
      id: u.id,
      nom: u.nom,
      email: u.email,
      role: u.role,
      statut: u.statut,
    })),
    serveurs: serveurs.map((u) => ({
      id: u.id,
      nom: u.nom,
      email: u.email,
      role: u.role,
    })),
  };

  const inventorySummary = {
    alimentsSources: aliments.map((a) => ({
      id: a.id,
      designation: a.designation,
      unite: a.unite,
      seuil: a.seuil,
      stock: a.stock,
      stockBloquant: a.stock_bloquant,
      puisable: a.puisable_en_portion,
    })),
    inventairesBoissonCount: inventairesBoisson.length,
    inventairesBoissonDates: inventairesBoisson.map((i) => ({
      id: i.id,
      date: i.date,
      statut: i.statut,
    })),
    approCount: appros.length,
    appros: appros.map((a) => ({
      id: a.id,
      date: a.date,
      statut: a.statut,
      montant: a.montant,
    })),
  };

  const crosswalk = {
    note: "Correspondance AquaPro id → King Fish id",
    plats: [...baseDishes, ...localDishes].map((d) => ({
      aquaId: d.aquaId,
      kingId: d.id,
      name: d.name,
      categorie: d.categorie,
      role: baseDishes.includes(d) ? "baseDish" : "localDish",
    })),
    boissons: drinks.map((d) => ({
      aquaId: d.aquaId,
      kingId: d.id,
      name: d.name,
      categorie: d.categorie,
    })),
  };

  await fs.writeFile(
    path.join(DIR, "kingfish-parametres-draft.json"),
    JSON.stringify(parametresDraft, null, 2),
  );
  await fs.writeFile(
    path.join(DIR, "kingfish-pos-config.json"),
    JSON.stringify(posConfig, null, 2),
  );
  await fs.writeFile(
    path.join(DIR, "kingfish-inventory-summary.json"),
    JSON.stringify(inventorySummary, null, 2),
  );
  await fs.writeFile(
    path.join(DIR, "kingfish-crosswalk.json"),
    JSON.stringify(crosswalk, null, 2),
  );

  console.log(
    JSON.stringify(
      {
        baseDishes: parametresDraft.baseDishes.length,
        localDishes: parametresDraft.localDishes.length,
        drinks: parametresDraft.drinks.length,
        categories: posConfig.categories.length,
        payments: posConfig.paymentMethods.length,
        tables: posConfig.tables.length,
        users: posConfig.users.length,
        inventairesBoisson: inventairesBoisson.length,
        appros: appros.length,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
