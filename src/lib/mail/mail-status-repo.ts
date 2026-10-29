import { getDb } from "@/lib/mongodb";

const DOC_ID = "brevo_status";

export type BrevoStatus = {
  ok: boolean;
  at: string;
  error?: string | null;
};

type StatusDoc = BrevoStatus & { _id: string };

/** Dernier résultat d'envoi Brevo, affiché aux admins (échec sinon invisible). */
export async function setBrevoStatus(input: {
  ok: boolean;
  error?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db.collection<StatusDoc>("app_settings").updateOne(
    { _id: DOC_ID },
    {
      $set: {
        ok: input.ok,
        at: new Date().toISOString(),
        error: input.ok ? null : (input.error ?? "Échec d'envoi").slice(0, 300),
      },
    },
    { upsert: true },
  );
}

export async function getBrevoStatus(): Promise<BrevoStatus | null> {
  const db = await getDb();
  const doc = await db
    .collection<StatusDoc>("app_settings")
    .findOne({ _id: DOC_ID });
  if (!doc) return null;
  return { ok: doc.ok, at: doc.at, error: doc.error ?? null };
}
