import { redirect } from "next/navigation";

/**
 * Ancienne page d'édition des combos, supprimée : les combos ne se
 * saisissent plus (catalogue vide côté Zogbo/Gbégamey), seul l'historique
 * (CA, combos_jours) subsiste et se consulte depuis le Registre.
 */
export default function Page() {
  redirect("/historique");
}