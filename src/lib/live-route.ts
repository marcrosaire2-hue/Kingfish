import { bumpLive } from "@/lib/live-state";

/**
 * Enveloppe une route d'écriture : si elle réussit, le compteur « en direct »
 * est incrémenté (avant l'envoi de la réponse).
 */
export function withLiveBump<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const res = await handler(...args);
    if (res.status < 400) {
      // Avant la réponse : la lecture qui suit une écriture voit déjà la
      // nouvelle version des données (cache de lecture invalidé).
      await bumpLive().catch(() => undefined);
    }
    return res;
  };
}
