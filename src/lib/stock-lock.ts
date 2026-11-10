import { getDb } from "@/lib/mongodb";
import { newId } from "@/lib/format";

/**
 * Verrou distribué (bail Mongo) pour les écritures de stock.
 *
 * Les verrous en mémoire (`Map`) ne protègent que le processus qui les porte :
 * deux instances Render, ou deux fonctions serverless, peuvent reporter le
 * même écart en parallèle. Ce verrou est partagé par la base.
 *
 * Le bail expire (`ttlMs`) : un processus planté ne bloque pas le stock
 * indéfiniment. Les opérations protégées sont courtes, un bail de 30 s suffit.
 */

const COLLECTION = "stock_locks";

type StockLockDoc = {
  _id: string;
  owner: string;
  acquiredAt: Date;
  expiresAt: Date;
};

export const STOCK_LOCK_WAIT_MS = 5_000;
export const STOCK_LOCK_TTL_MS = 30_000;

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type StockLock = {
  release: () => Promise<void>;
};

/**
 * Acquiert (ou attend) le verrou `key`. Échoue après `waitMs` si un autre
 * écrivain le détient encore.
 */
export async function acquireStockLock(
  key: string,
  options?: { ttlMs?: number; waitMs?: number; pollMs?: number },
): Promise<StockLock> {
  const ttlMs = options?.ttlMs ?? STOCK_LOCK_TTL_MS;
  const waitMs = options?.waitMs ?? STOCK_LOCK_WAIT_MS;
  const pollMs = options?.pollMs ?? 40;

  const db = await getDb();
  const col = db.collection<StockLockDoc>(COLLECTION);
  const owner = newId("lock");
  const deadline = Date.now() + waitMs;

  for (;;) {
    const now = new Date();
    try {
      await col.insertOne({
        _id: key,
        owner,
        acquiredAt: now,
        expiresAt: new Date(now.getTime() + ttlMs),
      });
      break;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Bail expiré : on le reprend.
      const taken = await col.findOneAndUpdate(
        { _id: key, expiresAt: { $lt: now } },
        {
          $set: {
            owner,
            acquiredAt: now,
            expiresAt: new Date(now.getTime() + ttlMs),
          },
        },
        { returnDocument: "after" },
      );
      if (taken) break;
      if (Date.now() >= deadline) {
        throw new Error(
          "Stock en cours de mise à jour par une autre saisie — réessayez dans un instant.",
        );
      }
      await sleep(pollMs + Math.random() * 30);
    }
  }

  return {
    release: async () => {
      await col.deleteOne({ _id: key, owner }).catch(() => undefined);
    },
  };
}

/** Exécute `write` en tenant le verrou `key`, puis le relâche toujours. */
export async function withStockLock<T>(
  key: string,
  write: () => Promise<T>,
  options?: { ttlMs?: number; waitMs?: number; pollMs?: number },
): Promise<T> {
  const lock = await acquireStockLock(key, options);
  try {
    return await write();
  } finally {
    await lock.release();
  }
}
