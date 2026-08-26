/**
 * Modèle commun des caisses — partagé par le serveur et l'écran Caisse.
 *
 * Zogbo et Gbégamey sont des caisses totalement indépendantes : pas de coffre
 * commun, pas de versement d'une zone vers l'autre. La clé `centrale` reste
 * dans le type pour lire l'historique, mais elle n'est plus utilisable.
 */
import type { UserRole, UserSite } from "@/lib/auth-types";
import type { CaisseKey, CaisseSession, VenteSite } from "@/lib/types";

/** Toutes les clés connues (y compris l'ancienne centrale, lecture seule). */
export const CAISSES: CaisseKey[] = ["centrale", "zogbo", "gbegamey"];

/** Caisses opérationnelles — une par site, sans mélange. */
export const ZONE_CAISSES: Array<"zogbo" | "gbegamey"> = ["zogbo", "gbegamey"];

export const CAISSE_LABELS: Record<CaisseKey, string> = {
  centrale: "Caisse centrale (archivée)",
  zogbo: "Caisse Zogbo",
  gbegamey: "Caisse Gbégamey",
};

export const CAISSE_SHORT_LABELS: Record<CaisseKey, string> = {
  centrale: "Centrale",
  zogbo: "Zogbo",
  gbegamey: "Gbégamey",
};

export function isCaisseKey(value: unknown): value is CaisseKey {
  return CAISSES.includes(value as CaisseKey);
}

export function isZoneCaisse(value: unknown): value is "zogbo" | "gbegamey" {
  return value === "zogbo" || value === "gbegamey";
}

/** Zone servie par une caisse ; `null` pour l'ancienne centrale. */
export function caisseZone(caisse: CaisseKey): VenteSite | null {
  return caisse === "centrale" ? null : caisse;
}

/** Caisse d'encaissement d'une zone — le POS n'a jamais à choisir. */
export function caisseForSite(site: VenteSite): CaisseKey {
  return site;
}

type Acteur = { role: UserRole; site: UserSite };

/**
 * Accès opérationnel : uniquement la caisse de zone du compte.
 * La centrale est retirée — les sites ne partagent plus de tiroir.
 */
export function canUseCaisse(user: Acteur, caisse: CaisseKey): boolean {
  if (!isZoneCaisse(caisse)) return false;
  return user.site === "tous" || user.site === caisse;
}

export function allowedCaisses(user: Acteur): Array<"zogbo" | "gbegamey"> {
  return ZONE_CAISSES.filter((c) => canUseCaisse(user, c));
}

/** Caisse ouverte par défaut à l'arrivée sur l'écran. */
export function defaultCaisse(user: Acteur): "zogbo" | "gbegamey" {
  if (user.site === "zogbo" || user.site === "gbegamey") return user.site;
  // Multi-sites : on ouvre Zogbo en premier ; l'UI permet de basculer.
  return "zogbo";
}

/**
 * Les versements entre caisses mélangeraient l'argent des deux sites.
 * Interdit : chaque site suit ses propres entrées / sorties.
 */
export function assertIndependentCaisseTransfer(
  from: CaisseKey,
  to: CaisseKey,
): void {
  throw new Error(
    `Transfert interdit entre ${CAISSE_LABELS[from]} et ${CAISSE_LABELS[to]} : ` +
      "Zogbo et Gbégamey ont des caisses indépendantes.",
  );
}

/**
 * Solde attendu dans le tiroir. Les versements historiques comptent au solde
 * mais jamais aux charges ni aux produits.
 */
export function soldeTheorique(s: CaisseSession): number {
  return (
    s.soldeInitial +
    s.totalVente +
    s.totalRecette +
    (Number(s.totalVersementRecu) || 0) -
    s.totalDepense -
    (Number(s.totalVersementSorti) || 0)
  );
}
