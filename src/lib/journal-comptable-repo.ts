import { listMouvementsByDateRange } from "@/lib/caisse-repo";
import {
  ecrituresChargeManuelle,
  ecrituresMouvement,
  ecrituresPartieDouble,
  ecrituresVente,
  ecrituresVersement,
  totaux,
  type EcritureComptable,
} from "@/lib/journal-comptable-calc";
import { COMPTE_CHARGE_MANUELLE, COMPTES } from "@/lib/plan-comptable";
import { listAcquisitionsSansCaisse, sumAmortissementsByDate } from "@/lib/immobilisations-repo";
import { getParametres } from "@/lib/parametres-repo";
import { sumPertesCost } from "@/lib/pertes-repo";
import { listChargesManuellesByDateRange } from "@/lib/synthese-repo";
import { getDb } from "@/lib/mongodb";
import type { MatieresLine, MatieresMovement, VenteSite } from "@/lib/types";
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
  aReclasser: EcritureComptable[];
  anomalies: Anomalie[];
  pertesExclues: { montant: number; note: string };
};

/**
 * Journal : ventes, trésorerie, CMV (consommation), pertes, amortissements,
 * et acquisitions/achats sans caisse (contrepartie 4711).
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

  const [ventes, mouvements, chargesManuelles, amortissements, immosSansCaisse] =
    await Promise.all([
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
      sumAmortissementsByDate({
        from: input.from,
        to: input.to,
        site: input.scopeSite ?? "all",
      }),
      listAcquisitionsSansCaisse({
        from: input.from,
        to: input.to,
        site: input.scopeSite ?? "all",
      }),
    ]);

  for (const t of ventes.tickets) {
    if (t.site !== "zogbo" && t.site !== "gbegamey") {
      anomalies.push({
        date: t.date,
        message: `Vente ${t.numero} : site "${t.site}" non reconnu, ignorée du journal.`,
      });
      continue;
    }
    const lignes = t.lines.filter((l) => (l.kind as string) !== "combo");
    if (lignes.length === 0) continue;
    ecritures.push(
      ...ecrituresVente({
        date: t.date,
        numero: t.numero,
        caisse: t.site,
        reduction: t.reduction,
        lignes: lignes.map((l) => ({ kind: l.kind, montant: l.amount })),
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

  const { consumedParJour, achatsSansCaisse, pertesMatieresParJour } =
    await loadMatieresJournal(input.from, input.to, input.scopeSite);

  for (const [date, montant] of Object.entries(consumedParJour)) {
    ecritures.push(
      ...ecrituresPartieDouble({
        date,
        piece: `cmv-${date}`,
        libelle: "Consommation matières (CMV)",
        debitCompte: COMPTES.ACHATS_MATIERES,
        creditCompte: COMPTES.STOCK_MATIERES,
        montant,
      }),
    );
  }

  for (const [date, montant] of Object.entries(pertesMatieresParJour)) {
    ecritures.push(
      ...ecrituresPartieDouble({
        date,
        piece: `perte-mat-${date}`,
        libelle: "Pertes de matières",
        debitCompte: COMPTES.PERTES_STOCK,
        creditCompte: COMPTES.STOCK_MATIERES,
        montant,
      }),
    );
  }

  for (const a of achatsSansCaisse) {
    ecritures.push(
      ...ecrituresPartieDouble({
        date: a.date,
        piece: `achat-${a.id}`,
        libelle: `Achat stock · ${a.name} (sans caisse)`,
        debitCompte: COMPTES.STOCK_MATIERES,
        creditCompte: COMPTES.COMPTE_ATTENTE,
        montant: a.montant,
        confiant: false,
      }),
    );
  }

  for (const item of immosSansCaisse) {
    const montant = item.acquisitionAmount ?? item.qty * item.cost;
    ecritures.push(
      ...ecrituresPartieDouble({
        date: item.date,
        piece: `immo-${item.id}`,
        libelle: `Immobilisation · ${item.name} (sans caisse)`,
        debitCompte: COMPTES.IMMOBILISATIONS,
        creditCompte: COMPTES.COMPTE_ATTENTE,
        montant,
        confiant: false,
      }),
    );
  }

  for (const [date, montant] of Object.entries(amortissements.parJour)) {
    ecritures.push(
      ...ecrituresPartieDouble({
        date,
        piece: `amort-${date}`,
        libelle: "Dotation aux amortissements",
        debitCompte: COMPTES.DOTATIONS_AMORT,
        creditCompte: COMPTES.AMORTISSEMENTS_CUMULES,
        montant,
      }),
    );
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
          ? "Les pertes matières sont passées en 6582 / 31. Les autres pertes (plats, boissons…) restent au compte de résultat applicatif."
          : "Aucune perte sur la période.",
    },
  };
}

async function loadMatieresJournal(
  from: string,
  to: string,
  scopeSite?: VenteSite | null,
): Promise<{
  consumedParJour: Record<string, number>;
  pertesMatieresParJour: Record<string, number>;
  achatsSansCaisse: { id: string; date: string; name: string; montant: number }[];
}> {
  const consumedParJour: Record<string, number> = {};
  const pertesMatieresParJour: Record<string, number> = {};
  const achatsSansCaisse: {
    id: string;
    date: string;
    name: string;
    montant: number;
  }[] = [];
  if (scopeSite) {
    return { consumedParJour, pertesMatieresParJour, achatsSansCaisse };
  }

  const parametres = await getParametres();
  const priceById = new Map(
    (parametres.rawMaterials ?? []).map((m) => [m.id, m.purchasePrice]),
  );
  const db = await getDb();
  const docs = await db
    .collection<{
      _id: string;
      lines?: MatieresLine[];
      movements?: MatieresMovement[];
    }>("matieres_jours")
    .find({ _id: { $gte: from, $lte: to } })
    .toArray();

  for (const doc of docs) {
    let consumed = 0;
    let pertes = 0;
    for (const line of doc.lines ?? []) {
      const price = priceById.get(line.productId) ?? 0;
      consumed += Math.max(0, Number(line.consumed) || 0) * price;
      pertes += Math.max(0, Number(line.pertes) || 0) * price;
    }
    if (consumed > 0) consumedParJour[doc._id] = Math.round(consumed);
    if (pertes > 0) pertesMatieresParJour[doc._id] = Math.round(pertes);

    for (const m of doc.movements ?? []) {
      if (m.cancelledAt || m.depenseId) continue;
      const montant = Math.round(
        (Number(m.qty) || 0) * (Number(m.unitPrice) || 0),
      );
      if (montant <= 0) continue;
      achatsSansCaisse.push({
        id: m.id,
        date: doc._id,
        name: m.name,
        montant,
      });
    }
  }

  return { consumedParJour, pertesMatieresParJour, achatsSansCaisse };
}
