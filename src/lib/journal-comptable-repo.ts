import { listMouvementsByDateRange } from "@/lib/caisse-repo";
import {
  ecrituresChargeManuelle,
  ecrituresMouvement,
  ecrituresVente,
  ecrituresVersement,
  totaux,
  type EcritureComptable,
} from "@/lib/journal-comptable-calc";
import { COMPTE_CHARGE_MANUELLE } from "@/lib/plan-comptable";
import { sumPertesCost } from "@/lib/pertes-repo";
import { listChargesManuellesByDateRange } from "@/lib/synthese-repo";
import type { VenteSite } from "@/lib/types";
import { listVentesHistory } from "@/lib/ventes-history-repo";

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export type Anomalie = {
  date: string;
  message: string;
};

export type JournalComptableResult = {
  from: string;
  to: string;
  ecritures: EcritureComptable[];
  totalDebit: number;
  totalCredit: number;
  equilibre: boolean;
  /** Écritures dont le classement n'est pas garanti — à vérifier. */
  aReclasser: EcritureComptable[];
  anomalies: Anomalie[];
  /** Coût des pertes de la période, volontairement exclu du journal. */
  pertesExclues: { montant: number; note: string };
};

/**
 * Construit le journal comptable de la période à partir des registres
 * existants (ventes, mouvements de caisse, charges saisies à la main).
 * Les pertes ne génèrent aucune écriture : leur coût est déjà inclus dans les
 * achats de matières (méthode de l'inventaire permanent par achats), les
 * compter une seconde fois doublerait la charge — à confirmer avec un
 * expert-comptable si un compte de stock valorisé est introduit un jour.
 */
export async function buildJournalComptable(input: {
  from: string;
  to: string;
  scopeSite?: VenteSite | null;
}): Promise<JournalComptableResult> {
  if (!isValidDate(input.from) || !isValidDate(input.to)) {
    throw new Error("Date invalide");
  }

  const ecritures: EcritureComptable[] = [];
  const anomalies: Anomalie[] = [];

  const [ventes, mouvements, chargesManuelles] = await Promise.all([
    listVentesHistory({
      from: input.from,
      to: input.to,
      site: input.scopeSite ?? "all",
      statut: "valide",
      source: "all",
      limit: "all",
    }),
    listMouvementsByDateRange({
      dateFrom: input.from,
      dateTo: input.to,
      scopeSite: input.scopeSite,
    }),
    listChargesManuellesByDateRange(input.from, input.to),
  ]);

  for (const t of ventes.tickets) {
    if (t.site !== "zogbo" && t.site !== "gbegamey") {
      anomalies.push({
        date: t.date,
        message: `Vente ${t.numero} : site "${t.site}" non reconnu, ignorée du journal.`,
      });
      continue;
    }
    ecritures.push(
      ...ecrituresVente({
        date: t.date,
        numero: t.numero,
        caisse: t.site,
        reduction: t.reduction,
        lignes: t.lines.map((l) => ({ kind: l.kind, montant: l.amount })),
      }),
    );
  }

  const versementsSorties = mouvements.filter(
    (m) => m.mouvement.kind === "versement-sortie",
  );
  for (const v of versementsSorties) {
    const destination = v.mouvement.contrepartie;
    if (!destination) {
      anomalies.push({
        date: v.date,
        message: `Versement ${v.mouvement.id} sans caisse de destination connue, ignoré.`,
      });
      continue;
    }
    ecritures.push(
      ...ecrituresVersement({
        date: v.date,
        source: v.caisse,
        destination,
        mouvement: v.mouvement,
      }),
    );
  }

  for (const m of mouvements) {
    if (
      m.mouvement.kind === "versement-sortie" ||
      m.mouvement.kind === "versement-entree"
    ) {
      continue;
    }
    ecritures.push(
      ...ecrituresMouvement({
        date: m.date,
        caisse: m.caisse,
        mouvement: m.mouvement,
      }),
    );
  }

  const postes = Object.keys(
    COMPTE_CHARGE_MANUELLE,
  ) as (keyof typeof COMPTE_CHARGE_MANUELLE)[];
  for (const charge of chargesManuelles) {
    for (const poste of postes) {
      const montant = charge[poste];
      if (typeof montant === "number" && montant > 0) {
        ecritures.push(
          ...ecrituresChargeManuelle({ date: charge.date, poste, montant }),
        );
      }
    }
  }

  const { total: pertesMontant } = await sumPertesCost({
    from: input.from,
    to: input.to,
    site: input.scopeSite ?? "all",
  });

  const { debit, credit, equilibre } = totaux(ecritures);
  if (!equilibre) {
    anomalies.push({
      date: `${input.from} → ${input.to}`,
      message: `Déséquilibre : débit ${debit} ≠ crédit ${credit}. Ne pas transmettre ce journal en l'état.`,
    });
  }

  return {
    from: input.from,
    to: input.to,
    ecritures,
    totalDebit: debit,
    totalCredit: credit,
    equilibre,
    aReclasser: ecritures.filter((e) => !e.confiant),
    anomalies,
    pertesExclues: {
      montant: pertesMontant,
      note:
        pertesMontant > 0
          ? "Coût déjà inclus dans les achats de matières (méthode par achats) — à ne pas ajouter une seconde fois sans validation comptable."
          : "Aucune perte sur la période.",
    },
  };
}
