/**
 * Un comptage physique est une photo du stock au moment de la saisie : il
 * remplace aussitôt le stock, et tout ce qui se passe ensuite (ventes, pertes,
 * entrées) s'applique à partir de lui. On retient donc l'état du stock à cet
 * instant ; l'écart constaté reste fixe, même si d'autres ventes suivent.
 */
export type ComptageRef = {
  /** Stock calculé juste avant le comptage (casiers pour les boissons). */
  theorique: number;
  /** Vendu du jour au moment du comptage. */
  vendu: number;
  /** Pertes du jour au moment du comptage. */
  pertes: number;
  /**
   * Horodatage du comptage. Sert au journal d'événements pour savoir ce qui
   * s'est passé après lui. Absent sur les anciens documents.
   */
  at?: string;
};

/**
 * Correction à ajouter au stock calculé. Un comptage ancien, sans repère, vaut
 * pour la fin de sa journée : le stock restant est alors le comptage lui-même.
 */
export function correctionComptage(
  compte: number | null | undefined,
  ref: ComptageRef | null | undefined,
  theoriqueBrut: number,
): number {
  if (compte === null || compte === undefined) return 0;
  return compte - (ref?.theorique ?? theoriqueBrut);
}

export function poserComptage(input: {
  ancienCompte: number | null | undefined;
  ancienRef: ComptageRef | null | undefined;
  nouveauCompte: number | null | undefined;
  etat: ComptageRef;
}): ComptageRef | undefined {
  if (input.nouveauCompte === null || input.nouveauCompte === undefined) {
    return undefined;
  }
  if (input.nouveauCompte === (input.ancienCompte ?? null)) {
    return input.ancienRef ?? undefined;
  }
  return { ...input.etat, at: new Date().toISOString() };
}

/** Applique le repère du comptage sur une ligne enregistrée côté serveur. */
export function avecComptage<
  L extends {
    counted: number | null;
    sold: number;
    pertes: number;
    comptage?: ComptageRef;
  },
>(
  ligne: L,
  avant: { counted: number | null; comptage?: ComptageRef } | null | undefined,
  theoriqueBrut: number,
): L {
  const reste: L = { ...ligne };
  delete reste.comptage;
  const comptage = poserComptage({
    ancienCompte: avant?.counted,
    ancienRef: avant?.comptage,
    nouveauCompte: ligne.counted,
    etat: { theorique: theoriqueBrut, vendu: ligne.sold, pertes: ligne.pertes },
  });
  return comptage ? { ...reste, comptage } : reste;
}
