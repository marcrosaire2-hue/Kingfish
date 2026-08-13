import { getDb } from "@/lib/mongodb";

/**
 * Écriture d’un document « jour » sous verrou optimiste.
 *
 * Ces documents portent des compteurs (vendu, préparé, envoyé) alimentés en
 * parallèle par la caisse et par les écrans d’inventaire. Une écriture
 * naïve — lire, modifier en mémoire, réécrire tout le document — perd la
 * modification de l’autre écrivain. Chaque écriture incrémente donc `rev`,
 * et ne passe que si `rev` n’a pas bougé depuis la lecture.
 */
const MAX_WRITE_ATTEMPTS = 8;

/**
 * Attente croissante et désynchronisée entre deux tentatives : sans ça,
 * les écrivains en conflit se retentent en même temps et se bloquent
 * mutuellement.
 */
function backoff(attempt: number): Promise<void> {
  const delay = attempt * 20 + Math.random() * 30;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export type DayDoc = { _id: string; rev?: number };

function revFilter(date: string, rev: number | undefined) {
  return rev === undefined
    ? { _id: date, rev: { $exists: false } }
    : { _id: date, rev };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export function assertValidDate(date: string): void {
  if (!isValidDate(date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }
}

/**
 * Refuse toute écriture sur une journée clôturée (reprise) : au-delà du
 * contrôle de vente déjà en place, achats matières et pertes contrediraient
 * eux aussi un inventaire et un compte de résultat déjà arrêtés.
 */
export function assertDayOpen(
  status: string | null | undefined,
  message = "Journée clôturée : modification impossible.",
): void {
  if (status === "cloturee") {
    throw new Error(message);
  }
}

/**
 * `build` reçoit le document tel qu’il est en base et renvoie les champs à
 * écrire plus la valeur à retourner. Il peut être rappelé plusieurs fois :
 * il doit rester une fonction pure du document lu.
 */
export async function updateDayDocument<TDoc extends DayDoc, TResult>(
  collectionName: string,
  date: string,
  build: (
    existing: TDoc | null,
  ) => Promise<{ set: Record<string, unknown>; result: TResult }>,
): Promise<TResult> {
  assertValidDate(date);
  const db = await getDb();
  const col = db.collection<TDoc>(collectionName);

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    if (attempt > 0) await backoff(attempt);

    const existing = (await col.findOne({
      _id: date,
    } as never)) as TDoc | null;
    const { set, result } = await build(existing);

    if (existing) {
      const written = await col.updateOne(revFilter(date, existing.rev) as never, {
        $set: set,
        $inc: { rev: 1 },
      } as never);
      if (written.matchedCount === 1) return result;
    } else {
      try {
        await col.insertOne({ _id: date, ...set, rev: 1 } as never);
        return result;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        // créé en parallèle : on relit et on retente
      }
    }
  }

  throw new Error(
    "Plusieurs saisies en même temps sur ce jour — réessayez dans un instant.",
  );
}
