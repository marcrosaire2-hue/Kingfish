import type { VenteSite } from "@/lib/types";

export type HistoriqueKind =
  | "vente"
  | "vente_annulee"
  | "transfert"
  | "zogbo"
  | "gbegamey"
  | "boissons"
  | "parametres"
  | "charges"
  | "user"
  | "caisse"
  | "pos"
  | "matieres"
  | "immobilisations"
  | "pertes"
  | "reprise";

export type HistoriqueSite = VenteSite | "tous" | null;

export type HistoriqueAction =
  | "ajout"
  | "modification"
  | "suppression"
  | "annulation";

export type HistoriqueEvent = {
  id: string;
  at: string;
  date: string | null;
  kind: HistoriqueKind;
  site: HistoriqueSite;
  title: string;
  detail: string;
  actorId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  amount: number | null;
  /** Action vente explicite (ajout, correction, suppression…). */
  action?: HistoriqueAction | null;
  productName?: string | null;
  qty?: number | null;
  previousQty?: number | null;
  unitPrice?: number | null;
  ticketNumero?: string | null;
  /** true si enregistré après le jour comptable affiché. */
  saisiTardif?: boolean;
};

export type HistoriqueActor = {
  id: string;
  name: string;
  username: string;
};

export const HISTORIQUE_KIND_LABELS: Record<HistoriqueKind, string> = {
  vente: "Vente",
  vente_annulee: "Annulation vente",
  transfert: "Transfert",
  zogbo: "Zogbo",
  gbegamey: "Gbégamey",
  boissons: "Boissons",
  parametres: "Paramètres",
  charges: "Charges",
  user: "Utilisateur",
  caisse: "Caisse",
  pos: "Ticket POS",
  matieres: "Matières",
  immobilisations: "Immobilisations",
  pertes: "Pertes",
  reprise: "Reprise d’historique",
};

export const HISTORIQUE_ACTION_LABELS: Record<HistoriqueAction, string> = {
  ajout: "Ajout",
  modification: "Modification",
  suppression: "Suppression",
  annulation: "Annulation",
};

export function formatActorLabel(ev: {
  actorName: string | null;
  actorUsername?: string | null;
}): string {
  if (ev.actorName && ev.actorUsername) {
    return `${ev.actorName} (@${ev.actorUsername})`;
  }
  if (ev.actorName) return ev.actorName;
  if (ev.actorUsername) return `@${ev.actorUsername}`;
  return "—";
}
