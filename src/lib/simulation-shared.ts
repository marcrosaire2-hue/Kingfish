/**
 * Mode Simulation (formation) — constantes partagées middleware / serveur / client.
 *
 * Principe : les écrans de la page Simulation appellent les vraies routes
 * d'API avec l'en-tête `x-simulation: 1`. Le middleware, après avoir vérifié
 * que le compte a le droit d'ouvrir la page Simulation, ajoute `x-sim-db`
 * (jamais fourni par le client) ; `getDb()` ouvre alors une base Mongo
 * jetable propre à l'utilisateur au lieu de la vraie base.
 */

/** En-tête posé par le client pour demander le mode simulation. */
export const SIM_REQUEST_HEADER = "x-simulation";

/** En-tête interne, posé uniquement par le middleware (toujours purgé en entrée). */
export const SIM_DB_HEADER = "x-sim-db";

/** Nom de la base bac à sable d'un utilisateur. */
export function simulationDbName(baseDb: string, username: string): string {
  const slug = username.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  return `${baseDb}_sim_${slug || "anon"}`;
}

/** Une base bac à sable a toujours ce préfixe : garde-fou dans getDb(). */
export function estNomBaseSimulation(baseDb: string, name: string): boolean {
  return (
    name.startsWith(`${baseDb}_sim_`) &&
    /^[A-Za-z0-9_]+$/.test(name) &&
    name.length < 100
  );
}

/**
 * API que les écrans simulés peuvent appeler (lecture et écriture, toutes
 * redirigées vers la base bac à sable). Liste fermée : le reste de l'API
 * (équipe, réglages, synthèse…) garde ses droits habituels.
 */
const SIM_API_PREFIXES = [
  "/api/vente",
  "/api/pos",
  "/api/pos-config",
  "/api/caisse",
  "/api/achats",
  "/api/matieres",
  "/api/pertes",
  "/api/compteur",
  "/api/fonds-caisse",
  "/api/immobilisations",
  "/api/tests-plats",
  "/api/boissons",
  "/api/zogbo",
  "/api/gbegamey",
  "/api/historique-ventes",
  "/api/synthese",
  "/api/ventes/totaux-jour",
  "/api/admin/ventes-stock",
];

export function estApiSimulable(pathname: string): boolean {
  return SIM_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** Collections jamais copiées dans le bac à sable (journaux, sessions, ventes réelles). */
export const SIM_COLLECTIONS_EXCLUES = new Set([
  "connexion_events",
  "connexion_sessions",
  "rate_limits",
  "login_attempts",
  "auditlogs",
  "synclogs",
  "historique",
  "autorisations_history",
  "notifications",
  // Opérations réelles : le stagiaire repart d'un jour vierge (ouverture de caisse…).
  "pos_tickets",
  "pos_counters",
  "pos_counters_test",
  "ventes_log",
  "sales",
  "saleitems",
  "caisse_mouvements",
  "caisses_sessions",
  "caisse_ventes_credits",
  "aquapro_caisses",
  "versements",
  "compteur_releves",
  "fonds_caisse",
  "expenses",
  "purchases",
]);
