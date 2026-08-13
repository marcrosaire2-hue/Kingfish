/**
 * Modèle commun des caisses — partagé par le serveur et l'écran Caisse.
 *
 * Aucune dépendance MongoDB ici : le composant client en a besoin pour
 * afficher les mêmes libellés et les mêmes règles d'accès que l'API, sans que
 * les deux se contredisent au fil du temps.
 */
import type { UserRole, UserSite } from "@/lib/auth-types";
import type { CaisseKey, CaisseSession, VenteSite } from "@/lib/types";

export const CAISSES: CaisseKey[] = ["centrale", "zogbo", "gbegamey"];

export const CAISSE_LABELS: Record<CaisseKey, string> = {
  centrale: "Caisse centrale",
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

/** Zone servie par une caisse ; `null` pour la centrale, qui ne vend pas. */
export function caisseZone(caisse: CaisseKey): VenteSite | null {
  return caisse === "centrale" ? null : caisse;
}

/** Caisse d'encaissement d'une zone — le POS n'a jamais à choisir. */
export function caisseForSite(site: VenteSite): CaisseKey {
  return site;
}

type Acteur = { role: UserRole; site: UserSite };

/**
 * Le coffre central consolide les soldes des deux zones : réservé à
 * l'administrateur global. Les caisses de zone suivent le périmètre du
 * compte, comme le reste du site.
 */
export function canUseCaisse(user: Acteur, caisse: CaisseKey): boolean {
  if (caisse === "centrale") {
    return user.role === "admin" && user.site === "tous";
  }
  return user.site === "tous" || user.site === caisse;
}

export function allowedCaisses(user: Acteur): CaisseKey[] {
  return CAISSES.filter((c) => canUseCaisse(user, c));
}

/** Caisse ouverte par défaut à l'arrivée sur l'écran. */
export function defaultCaisse(user: Acteur): CaisseKey {
  if (user.site === "zogbo" || user.site === "gbegamey") return user.site;
  return canUseCaisse(user, "centrale") ? "centrale" : "gbegamey";
}

/**
 * Solde attendu dans le tiroir. Les versements comptent au solde mais jamais
 * aux charges ni aux produits : ils ne font que déplacer l'argent.
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
