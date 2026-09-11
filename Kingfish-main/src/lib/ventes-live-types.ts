import type { VenteSite } from "@/lib/types";

/** Ticket POS récemment encaissé, pour le suivi live admin. */
export type VenteLiveEvent = {
  id: string;
  at: string;
  date: string;
  site: VenteSite;
  numero: string;
  montant: number;
  nbLignes: number;
  serveurNom: string | null;
  userName: string;
  saleType: string;
  paymentLabel: string | null;
};

export type VentesLiveBoard = {
  events: VenteLiveEvent[];
  serverTime: string;
};
