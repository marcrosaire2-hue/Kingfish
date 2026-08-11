import type { SessionUser } from "@/lib/auth-types";
import {
  appendHistorique,
  type HistoriqueActor,
  type HistoriqueKind,
  type HistoriqueSite,
} from "@/lib/historique-repo";

export function actorOf(
  user: SessionUser | null | undefined,
): HistoriqueActor | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
  };
}

export async function logActivity(input: {
  user?: SessionUser | null;
  kind: Exclude<HistoriqueKind, "vente">;
  title: string;
  detail: string;
  date?: string | null;
  site?: HistoriqueSite;
  amount?: number | null;
}): Promise<void> {
  try {
    await appendHistorique({
      kind: input.kind,
      title: input.title,
      detail: input.detail,
      date: input.date,
      site: input.site,
      amount: input.amount,
      actor: actorOf(input.user),
    });
  } catch (error) {
    console.error("historique log failed", error);
  }
}
