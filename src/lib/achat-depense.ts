import type { SessionUser } from "@/lib/auth-types";
import {
  addCaisseMouvement,
  resolveCaisseForDepense,
} from "@/lib/caisse-repo";
import { linkMatieresMovementDepense } from "@/lib/matieres-repo";
import type { VenteSite } from "@/lib/types";

/** Écrit la sortie de caisse d'un achat et la rattache à son mouvement. */
export async function attachDepense(input: {
  user: SessionUser;
  date: string;
  movementId: string;
  name: string;
  qty: number;
  fournisseurNom: string | null;
  montant: number;
  bypassPast: boolean;
  site: VenteSite;
}): Promise<{ id: string; montant: number } | { error: string } | null> {
  if (input.montant <= 0) return null;
  try {
    const { session, allowClosed } = await resolveCaisseForDepense({
      site: input.site,
      date: input.date,
      allowPastClosed: input.bypassPast,
    });
    if (!session) return null;
    const res = await addCaisseMouvement({
      caisseId: session.id,
      user: input.user,
      kind: "depense",
      nature: `Achat stock · ${input.name} +${input.qty}`,
      beneficiaire: input.fournisseurNom ?? "Fournisseur non précisé",
      montant: input.montant,
      allowClosed,
    });
    await linkMatieresMovementDepense({
      site: input.site,
      date: input.date,
      movementId: input.movementId,
      depenseId: res.mouvement.id,
    });
    return { id: res.mouvement.id, montant: input.montant };
  } catch (e) {
    // Plus de silence : l'appelant prévient l'utilisateur et le journal.
    return {
      error:
        e instanceof Error ? e.message : "Sortie de caisse non enregistrée.",
    };
  }
}
