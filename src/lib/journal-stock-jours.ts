import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import { lireStocksInitiauxBruts } from "@/lib/stock-si-repo";
import { computeBoissonsLine, normalizeBoissonsLine } from "@/lib/boissons-calc";
import { computeLocalLine, computeTransferLine } from "@/lib/gbegamey-calc";
import { computeZogboAccompanimentLine, computeZogboLine } from "@/lib/zogbo-calc";
import type { VenteSite } from "@/lib/types";

/**
 * Journal de stock : une ligne par jour et par produit, comme les fiches
 * d'inventaire. Stock initial du jour (ouverture) + Entrées = Disponible ;
 * Disponible − Vendus − Pertes = Stock théorique ; Écart = Physique − Théorique.
 * Boissons en bouteilles. Seules les lignes non vides sont gardées.
 */
export type JournalFamille = "plat" | "local" | "boisson";

export type JournalStockJour = {
  date: string;
  famille: JournalFamille;
  productId: string;
  name: string;
  ouverture: number;
  entrees: number;
  disponible: number;
  vendus: number;
  pertes: number;
  theorique: number;
  physique: number | null;
  ecart: number | null;
};

const arrondi = (n: number) => Math.round(n * 100) / 100;

export function ligneVide(l: JournalStockJour): boolean {
  return (
    l.ouverture === 0 &&
    l.entrees === 0 &&
    l.vendus === 0 &&
    l.pertes === 0 &&
    l.physique === null
  );
}

export async function getJournalStockJours(input: {
  site: VenteSite;
  from: string;
  to: string;
  famille?: "toutes" | JournalFamille;
}): Promise<JournalStockJour[]> {
  const famille = input.famille ?? "toutes";
  const veut = (f: JournalFamille) => famille === "toutes" || famille === f;
  const db = await getDb();
  const { drinks } = await getParametres();
  const drinkById = new Map(drinks.map((d) => [d.id, d]));
  const range = { _id: { $gte: input.from, $lte: input.to } };
  const out: JournalStockJour[] = [];

  if (input.site === "gbegamey" && (veut("plat") || veut("local"))) {
    const jours = await db
      .collection<{ _id: string; transferLines?: never[]; localLines?: never[] }>("gbegamey_jours")
      .find(range)
      .toArray();
    for (const j of jours) {
      if (veut("plat")) {
        for (const line of j.transferLines ?? []) {
          const c = computeTransferLine(line, 0, 0);
          out.push({
            date: j._id,
            famille: "plat",
            productId: c.productId,
            name: c.name,
            ouverture: arrondi(c.initialStock),
            entrees: arrondi(c.available - c.initialStock),
            disponible: arrondi(c.available),
            vendus: c.sold,
            pertes: c.pertes,
            theorique: arrondi(c.theoreticalRemaining),
            physique: c.counted,
            ecart: c.variance,
          });
        }
      }
      if (veut("local")) {
        for (const line of j.localLines ?? []) {
          const c = computeLocalLine(line, 0);
          out.push({
            date: j._id,
            famille: "local",
            productId: c.productId,
            name: c.name,
            ouverture: arrondi(c.initialStock),
            entrees: arrondi(c.prepared),
            disponible: arrondi(c.available),
            vendus: c.sold,
            pertes: c.pertes,
            theorique: arrondi(c.theoreticalRemaining),
            physique: c.counted,
            ecart: c.variance,
          });
        }
      }
    }
  }

  if (input.site === "zogbo" && (veut("plat") || veut("local"))) {
    const jours = await db
      .collection<{ _id: string; lines?: never[]; accompanimentLines?: never[] }>("zogbo_jours")
      .find(range)
      .toArray();
    for (const j of jours) {
      if (veut("plat")) {
        for (const line of j.lines ?? []) {
          const c = computeZogboLine(line, 0);
          out.push({
            date: j._id,
            famille: "plat",
            productId: c.productId,
            name: c.name,
            ouverture: arrondi(Math.max(0, c.stock - c.prepared)),
            entrees: arrondi(c.prepared),
            disponible: arrondi(c.available),
            vendus: c.sold,
            pertes: c.pertes,
            theorique: arrondi(c.theoreticalRemaining),
            physique: c.counted,
            ecart: c.variance,
          });
        }
      }
      if (veut("local")) {
        for (const line of j.accompanimentLines ?? []) {
          const c = computeZogboAccompanimentLine(line, 0);
          out.push({
            date: j._id,
            famille: "local",
            productId: c.productId,
            name: c.name,
            ouverture: arrondi(c.initialStock),
            entrees: arrondi(c.prepared),
            disponible: arrondi(c.available),
            vendus: c.sold,
            pertes: c.pertes,
            theorique: arrondi(c.theoreticalRemaining),
            physique: c.counted,
            ecart: c.variance,
          });
        }
      }
    }
  }

  if (veut("boisson")) {
    const jours = await db
      .collection<{ _id: string; lines?: never[] }>("boissons_jours")
      .find(range)
      .toArray();
    const z = input.site === "zogbo";
    for (const j of jours) {
      for (const raw of j.lines ?? []) {
        const line = normalizeBoissonsLine(raw);
        const c = computeBoissonsLine(line, drinkById.get(line.productId));
        const upc = c.unitsPerCasier;
        const ouverture = (z ? c.initialStockZogbo : c.initialStockGbegamey) * upc;
        const entrees = (z ? c.purchasesZogbo : c.purchasesGbegamey) * upc;
        const vendus = z ? c.soldZogbo : c.soldGbegamey;
        const pertes = z ? c.pertesZogbo : c.pertesGbegamey;
        const physique = z ? c.countedZogbo : c.countedGbegamey;
        const theorique = Math.max(0, ouverture + entrees - vendus - pertes);
        out.push({
          date: j._id,
          famille: "boisson",
          productId: line.productId,
          name: line.name,
          ouverture: Math.round(ouverture),
          entrees: Math.round(entrees),
          disponible: Math.round(ouverture + entrees),
          vendus,
          pertes,
          theorique: Math.round(theorique),
          physique,
          ecart: physique === null ? null : Math.round(physique - theorique),
        });
      }
    }
  }

  // Jour du stock de départ : le comptage de départ s’affiche en Stock initial
  // (le stock par lequel tout a commencé), pas en entrée.
  const sis = await lireStocksInitiauxBruts(input.site);
  for (const l of out) {
    const base = sis.get(`${l.famille}:${l.productId}`);
    if (base && base.date === l.date && l.ouverture === 0 && l.entrees >= base.si) {
      l.ouverture = base.si;
      l.entrees = arrondi(l.entrees - base.si);
    }
  }

  return out
    .filter((l) => !ligneVide(l))
    .sort((a, b) => b.date.localeCompare(a.date) || a.famille.localeCompare(b.famille) || a.name.localeCompare(b.name));
}
