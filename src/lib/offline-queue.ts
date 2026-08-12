"use client";

/**
 * File d'attente locale des ventes.
 *
 * Quand le réseau tombe en plein service, un ticket validé ne doit pas être
 * perdu : il est écrit dans localStorage, puis rejoué dès que la connexion
 * revient. Le serveur reste seul maître du stock — la file ne fait que
 * différer l'appel, elle ne calcule rien.
 *
 * localStorage plutôt qu'IndexedDB : le volume est minuscule (quelques
 * dizaines de tickets au pire), l'écriture est synchrone donc rien ne se perd
 * si l'onglet est fermé brutalement, et le code reste lisible.
 */

const CLE = "kingfish.ventes-en-attente";
const MAX = 200;

export type VenteEnAttente = {
  /** Identifiant local, sert aussi de clé d'idempotence côté serveur. */
  id: string;
  /** Corps exact du POST /api/pos, tel qu'il aurait été envoyé. */
  corps: unknown;
  /** Horodatage de la vente réelle, pas celui de la synchronisation. */
  creeA: string;
  /** Nombre de tentatives de renvoi déjà effectuées. */
  tentatives: number;
};

type Ecouteur = (file: VenteEnAttente[]) => void;

const ecouteurs = new Set<Ecouteur>();

function lire(): VenteEnAttente[] {
  if (typeof window === "undefined") return [];
  try {
    const brut = window.localStorage.getItem(CLE);
    if (!brut) return [];
    const parsed = JSON.parse(brut);
    return Array.isArray(parsed) ? (parsed as VenteEnAttente[]) : [];
  } catch {
    // Stockage illisible (quota, données corrompues) : on repart d'une file
    // vide plutôt que de bloquer la caisse.
    return [];
  }
}

function ecrire(file: VenteEnAttente[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLE, JSON.stringify(file.slice(-MAX)));
  } catch {
    /* quota dépassé : la vente en cours prime sur l'historique local */
  }
  for (const ecouteur of ecouteurs) ecouteur(file);
}

export function fileEnAttente(): VenteEnAttente[] {
  return lire();
}

export function nombreEnAttente(): number {
  return lire().length;
}

export function surChangement(ecouteur: Ecouteur): () => void {
  ecouteurs.add(ecouteur);
  return () => ecouteurs.delete(ecouteur);
}

export function ajouterEnAttente(corps: unknown): VenteEnAttente {
  const entree: VenteEnAttente = {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    corps,
    creeA: new Date().toISOString(),
    tentatives: 0,
  };
  ecrire([...lire(), entree]);
  return entree;
}

function retirer(id: string): void {
  ecrire(lire().filter((e) => e.id !== id));
}

function incrementerTentative(id: string): void {
  ecrire(
    lire().map((e) => (e.id === id ? { ...e, tentatives: e.tentatives + 1 } : e)),
  );
}

export type ResultatSynchro = {
  envoyees: number;
  echecs: number;
  restantes: number;
};

let synchroEnCours = false;

/**
 * Rejoue les ventes en attente, dans l'ordre où elles ont été encaissées.
 *
 * On s'arrête à la première panne réseau : inutile de marteler un serveur
 * injoignable, et l'ordre chronologique des ventes doit être préservé. En
 * revanche un refus métier (400) ne disparaîtra pas tout seul — la vente est
 * retirée de la file après plusieurs tentatives, pour ne pas la bloquer
 * indéfiniment.
 */
export async function synchroniser(): Promise<ResultatSynchro> {
  if (synchroEnCours) {
    return { envoyees: 0, echecs: 0, restantes: nombreEnAttente() };
  }
  synchroEnCours = true;
  let envoyees = 0;
  let echecs = 0;

  try {
    for (const entree of lire()) {
      let reponse: Response;
      try {
        reponse = await fetch("/api/pos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Vente-Locale": entree.id,
          },
          body: JSON.stringify(entree.corps),
        });
      } catch {
        // Toujours hors ligne : on garde la file intacte pour plus tard.
        break;
      }

      if (reponse.ok) {
        retirer(entree.id);
        envoyees += 1;
        continue;
      }

      if (reponse.status >= 500) {
        // Panne serveur : on réessaiera, la vente reste valide.
        incrementerTentative(entree.id);
        echecs += 1;
        break;
      }

      // Refus métier : stock épuisé entre-temps, caisse fermée… Après trois
      // tentatives on sort la vente de la file pour ne pas figer les suivantes.
      incrementerTentative(entree.id);
      echecs += 1;
      if (entree.tentatives + 1 >= 3) retirer(entree.id);
    }
  } finally {
    synchroEnCours = false;
  }

  return { envoyees, echecs, restantes: nombreEnAttente() };
}

/** Enregistre le service worker et déclenche une synchro au retour du réseau. */
export function installerSupportHorsLigne(
  onChangement?: (file: VenteEnAttente[]) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* pas de service worker : la file d'attente fonctionne quand même */
    });
  }

  const auRetour = () => void synchroniser();
  window.addEventListener("online", auRetour);

  const desabonner = onChangement ? surChangement(onChangement) : () => {};

  // Une vente peut rester en attente d'une session à l'autre.
  if (navigator.onLine) void synchroniser();

  return () => {
    window.removeEventListener("online", auRetour);
    desabonner();
  };
}
