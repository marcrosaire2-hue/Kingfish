import { getDb } from "@/lib/mongodb";
import type { CaisseMouvement, CaisseSession, VenteSite } from "@/lib/types";
import {
  type CaisseDoc,
  type MouvementDoc,
  getActiveCaisse,
  toMouvement,
} from "@/lib/caisse-repo";
import type { CaisseKey } from "@/lib/types";

export type DepenseRow = {
  sessionId: string;
  sessionDate: string;
  sessionUserName: string | null;
  mouvement: CaisseMouvement;
};

/**
 * Dépenses enregistrées sur la caisse d'un site pour une journée. Les
 * sessions antérieures aux caisses nommées ne portent qu'un site : il fait
 * foi (même règle que filtreCaisse côté caisse).
 */
export async function listDepensesByCaisse(input: {
  caisse: CaisseKey;
  date: string;
}): Promise<DepenseRow[]> {
  const db = await getDb();
  const sessions = await db
    .collection<CaisseDoc>("caisses_sessions")
    .find({
      date: input.date,
      $or: [
        { caisse: input.caisse },
        { caisse: { $exists: false }, site: input.caisse as VenteSite },
      ],
    })
    .sort({ openedAt: -1 })
    .toArray();
  if (sessions.length === 0) return [];

  const ids = sessions.map((s) => s._id.toHexString());
  const docs = await db
    .collection<MouvementDoc>("caisse_mouvements")
    .find({ caisseId: { $in: ids }, kind: "depense" })
    .sort({ at: -1 })
    .toArray();

  const sessionById = new Map(
    sessions.map((s) => [s._id.toHexString(), s]),
  );
  return docs.flatMap((d) => {
    const session = sessionById.get(d.caisseId);
    if (!session) return [];
    return [
      {
        sessionId: d.caisseId,
        sessionDate: session.date,
        sessionUserName: session.userName ?? null,
        mouvement: toMouvement(d),
      },
    ];
  });
}

/** Session ouverte d'une caisse — sert à prévenir l'écran Achats. */
export async function getOpenCaisse(
  caisse: CaisseKey,
): Promise<CaisseSession | null> {
  return getActiveCaisse(caisse);
}