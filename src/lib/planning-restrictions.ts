/**
 * Interrupteur des restrictions liées aux plannings et aux horaires :
 * créneaux des comptes equipe (Zogbo / Gbégamey), planning nominatif des
 * employés Gbégamey, refus de connexion et coupure de session hors créneau.
 *
 * Désactivées par défaut : le code des plannings est conservé tel quel, seule
 * son application est suspendue. Pour les réactiver, définir la variable
 * d'environnement `PLANNING_RESTRICTIONS=on` puis redéployer.
 */
export function planningRestrictionsActives(): boolean {
  return process.env.PLANNING_RESTRICTIONS === "on";
}
