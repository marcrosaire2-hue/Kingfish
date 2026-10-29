/**
 * Cache mémoire à durée de vie courte, pour les lectures très répétées
 * (compte connecté, catalogue, droits, réglages caisse) : chacune coûte un
 * aller-retour réseau vers la base à chaque appel d'API.
 *
 * - les appels simultanés partagent une seule lecture ;
 * - chaque lecture rend une copie : un appelant ne peut pas corrompre le cache ;
 * - toute écriture invalide l'entrée (invalidateCache), la durée de vie ne
 *   sert que de filet pour les autres instances du serveur.
 */
type Entry = { at: number; value?: unknown; pending?: Promise<unknown> };

const store = new Map<string, Entry>();

function copy<T>(value: T): T {
  return value !== null && typeof value === "object" ? structuredClone(value) : value;
}

/** Évite que les clés périmées (une par version des données) s'accumulent. */
function purgeStale(): void {
  if (store.size < 300) return;
  const limit = Date.now() - 5 * 60_000;
  for (const [key, entry] of store) {
    if (!entry.pending && entry.at < limit) store.delete(key);
  }
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  purgeStale();
  const hit = store.get(key);
  if (hit) {
    if (hit.pending) return copy((await hit.pending) as T);
    if (Date.now() - hit.at < ttlMs) return copy(hit.value as T);
  }
  const pending = load().then(
    (value) => {
      store.set(key, { at: Date.now(), value: copy(value) });
      return value;
    },
    (error) => {
      store.delete(key);
      throw error;
    },
  );
  store.set(key, { at: Date.now(), pending });
  return copy(await pending);
}

/** Retire toutes les entrées dont la clé contient `part`. */
export function invalidateCache(part: string): void {
  for (const key of [...store.keys()]) {
    if (key.includes(part)) store.delete(key);
  }
}
