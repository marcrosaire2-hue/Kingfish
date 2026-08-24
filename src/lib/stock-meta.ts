/**
 * Métadonnées de la page Stock : familles et zones.
 *
 * Module volontairement sans dépendance serveur (aucun import Mongo) :
 * il est consommé tel quel par le composant client `stock-page`.
 */

export type StockFamily =
  | "plats"
  | "accompagnements"
  | "boissons"
  | "matieres";

export type StockZone =
  | "zogbo-plats"
  | "zogbo-accompagnements"
  | "gbegamey-plats"
  | "gbegamey-accompagnements"
  | "zogbo-boissons"
  | "gbegamey-boissons"
  | "matieres";

export type StockKind = "plat" | "local" | "boisson" | "matiere";

export const STOCK_FAMILY_META: {
  family: StockFamily;
  label: string;
  zones: StockZone[];
}[] = [
  {
    family: "plats",
    label: "Plats",
    zones: ["zogbo-plats", "gbegamey-plats"],
  },
  {
    family: "accompagnements",
    label: "Accompagnements",
    zones: ["zogbo-accompagnements", "gbegamey-accompagnements"],
  },
  {
    family: "boissons",
    label: "Boissons",
    zones: ["zogbo-boissons", "gbegamey-boissons"],
  },
  {
    family: "matieres",
    label: "Matières premières",
    zones: ["matieres"],
  },
];

export function zoneFamily(zone: StockZone): StockFamily {
  for (const meta of STOCK_FAMILY_META) {
    if (meta.zones.includes(zone)) return meta.family;
  }
  return "plats";
}

/** Route de la fiche détaillée derrière chaque zone. */
export function zoneRoute(zone: StockZone, date: string): string {
  switch (zone) {
    case "zogbo-plats":
    case "zogbo-accompagnements":
      return `/zogbo?date=${date}`;
    case "gbegamey-plats":
    case "gbegamey-accompagnements":
      return `/gbegamey?date=${date}`;
    case "zogbo-boissons":
    case "gbegamey-boissons":
      return `/boissons?date=${date}`;
    case "matieres":
      return `/appro?date=${date}`;
  }
}
