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
const CLE_REJETS = "kingfish.ventes-rejetees";
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
  /** Compte qui a encaissé — le serveur reste l'autorité à la synchro. */
  userId?: string;
};

let currentUserId: string | null = null;

export function setOfflineQueueUser(userId: string | null): void {
  currentUserId = userId;
}

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

/**
 * `reference` : identifiant déjà envoyé au serveur lors de la tentative en
 * ligne. Le réutiliser garantit qu'une vente partie mais dont la réponse s'est
 * perdue sera reconnue au rejeu, au lieu d'être encaissée une seconde fois.
 */
export function ajouterEnAttente(
  corps: unknown,
  reference?: string,
): VenteEnAttente {
  const entree: VenteEnAttente = {
    id: reference || `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    corps,
    creeA: new Date().toISOString(),
    tentatives: 0,
    userId: currentUserId ?? undefined,
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

/**
 * Ventes définitivement refusées par le serveur au rejeu (stock épuisé
 * entre-temps, caisse fermée…). Elles sortent de la file d'attente mais ne
 * disparaissent pas sans trace : le registre alimente une alerte visible à
 * l'écran de vente, pour ressaisie ou vérification en caisse.
 */
export type VenteRejetee = {
  /** Identifiant de la vente initiale. */
  id: string;
  /** Horodatage de la vente réelle. */
  creeA: string;
  /** Motif renvoyé par le serveur, lisible par le caissier. */
  raison: string;
  /** Moment du refus définitif. */
  rejeteA: string;
};

type EcouteurRejet = (rejets: VenteRejetee[]) => void;

const ecouteursRejet = new Set<EcouteurRejet>();

function lireRejets(): VenteRejetee[] {
  if (typeof window === "undefined") return [];
  try {
    const brut = window.localStorage.getItem(CLE_REJETS);
    const parsed = brut ? JSON.parse(brut) : [];
    return Array.isArray(parsed) ? (parsed as VenteRejetee[]) : [];
  } catch {
    return [];
  }
}

function ecrireRejets(rejets: VenteRejetee[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLE_REJETS, JSON.stringify(rejets.slice(-MAX)));
  } catch {
    /* quota dépassé : tant pis pour le registre */
  }
  for (const ecouteur of ecouteursRejet) ecouteur(rejets);
}

export function rejetsEnAttente(): VenteRejetee[] {
  return lireRejets();
}

export function surRejet(ecouteur: EcouteurRejet): () => void {
  ecouteursRejet.add(ecouteur);
  return () => {
    ecouteursRejet.delete(ecouteur);
  };
}

/** Efface le registre après prise en charge par le caissier ou le gérant. */
export function marquerRejetsTraites(): void {
  ecrireRejets([]);
}

async function raisonDuRefus(reponse: Response): Promise<string> {
  try {
    const body = (await reponse.json()) as { error?: unknown };
    if (body && typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    /* corps illisible : message générique */
  }
  return `Refusée par le serveur (erreur ${reponse.status}).`;
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
 * injoignable, et l'ordre chronologique des ventes doit être préservé. Un
 * refus métier (400) ne bloque pas la file au-delà de trois tentatives :
 * la vente sort alors de la file et rejoint le registre des rejets,
 * affiché en alerte à l'écran de vente.
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
      if (
        currentUserId &&
        entree.userId &&
        entree.userId !== currentUserId
      ) {
        continue;
      }
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
      // tentatives on sort la vente de la file pour ne pas figer les suivantes
      // — mais elle rejoint le registre des rejets, affiché en alerte à
      // l'écran : une commande perdue sans rien dire n'est pas acceptable.
      incrementerTentative(entree.id);
      echecs += 1;
      if (entree.tentatives + 1 >= 3) {
        retirer(entree.id);
        ecrireRejets([
          ...lireRejets(),
          {
            id: entree.id,
            creeA: entree.creeA,
            raison: await raisonDuRefus(reponse),
            rejeteA: new Date().toISOString(),
          },
        ]);
      }
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
