import { getDb } from "@/lib/mongodb";
import { readLiveSeq } from "@/lib/live-state";
import { getSessionUser } from "@/lib/session";
import { cached, invalidateCache } from "@/lib/ttl-cache";

type Stored = { status: number; text: string };

/**
 * Cache de lecture pour les écrans de consultation lourds (agrégations sur la
 * base). La clé contient le compteur « en direct » : dès qu'une écriture a
 * lieu (sur n'importe quel poste), le compteur change et tout est recalculé ;
 * sans écriture, la même demande est resservie instantanément.
 *
 * Une entrée est propre à un compte et à une base (mode Simulation compris).
 * Seules les réponses 200 sont gardées.
 */
export function withReadCache(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const user = await getSessionUser().catch(() => null);
    if (!user) return handler(request);

    const db = await getDb();
    const seq = await readLiveSeq();
    const key = `${db.databaseName}:read:${user.id}:${seq}:${request.url}`;

    const result = await cached<Stored>(key, 60_000, async () => {
      const res = await handler(request);
      return { status: res.status, text: await res.text() };
    });
    if (result.status !== 200) invalidateCache(key);

    return new Response(result.text, {
      status: result.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  };
}
