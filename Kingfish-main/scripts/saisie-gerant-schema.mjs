/**
 * Classeur ventes journalières — plat, accompagnement, boisson uniquement.
 */

export const TEMPLATE_ROWS = 80;

export const VENTES_FIELDS = [
  f("Date", "Requis", "2026-08-22", "AAAA-MM-JJ"),
  f("Site", "Requis", "zogbo", "zogbo ou gbegamey"),
  f("Catégorie", "Requis", "plat", "plat | accompagnement | boisson"),
  f("Produit", "Requis", "CHOUKOUYA"),
  f("Quantité", "Requis", "2", "Nombre vendu ce jour"),
];

export const GUIDE = [
  {
    Étape: "1",
    Action: "Remplir l'onglet Ventes : une ligne = une vente (ou total du jour par produit)",
  },
  {
    Étape: "2",
    Action: "Catégories autorisées : plat · accompagnement · boisson (rien d'autre)",
  },
  {
    Étape: "3",
    Action: "Date au format AAAA-MM-JJ — regrouper par jour en triant la colonne Date",
  },
  {
    Étape: "4",
    Action: "Site : zogbo ou gbegamey selon le point de vente",
  },
  {
    Étape: "5",
    Action: "Liste des produits : voir onglets Plats, Accompagnements, Boissons",
  },
  {
    Étape: "6",
    Action: "Onglets Jour_AAAA-MM-JJ : saisie du jour sur une feuille dédiée (optionnel)",
  },
  {
    Étape: "7",
    Action: "Import : npm run excel:import (simulation) puis npm run excel:import:apply",
  },
];

function f(key, required, example = "", notes = "") {
  return { key, required, example, notes };
}

export function obligationRow(fields) {
  const row = {};
  for (const [i, field] of fields.entries()) {
    row[field.key] = i === 0 ? "→ OBLIGATION" : field.required;
  }
  return row;
}

export function exampleRow(fields) {
  const row = {};
  for (const [i, field] of fields.entries()) {
    row[field.key] = i === 0 ? "→ EXEMPLE" : field.example || "";
  }
  return row;
}

export function emptyRow(fields) {
  const row = {};
  for (const field of fields) row[field.key] = "";
  return row;
}

export function buildVentesRows(existing = []) {
  const rows = [
    obligationRow(VENTES_FIELDS),
    exampleRow(VENTES_FIELDS),
    ...existing,
  ];
  for (let i = 0; i < TEMPLATE_ROWS; i++) rows.push(emptyRow(VENTES_FIELDS));
  return rows;
}

/** Feuille d'un jour : produits du catalogue + colonne Quantité */
export function buildDaySheetRows(catalog, date, existingByProduct = new Map()) {
  const rows = [
    {
      Produit: "→ EXEMPLE",
      Catégorie: "plat",
      Quantité: "2",
    },
  ];
  for (const item of catalog) {
    const key = `${item.categorie}|${item.name}`;
    rows.push({
      Produit: item.name,
      Catégorie: item.categorie,
      Quantité: existingByProduct.get(key) ?? "",
    });
  }
  for (let i = 0; i < 15; i++) {
    rows.push({ Produit: "", Catégorie: "", Quantité: "" });
  }
  return rows;
}

export function kindToCategorie(kind) {
  if (kind === "local") return "accompagnement";
  if (kind === "plat") return "plat";
  if (kind === "boisson") return "boisson";
  return null;
}
