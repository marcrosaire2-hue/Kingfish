import { listMouvementsByDateRange } from "@/lib/caisse-repo";
import {
  ecrituresChargeManuelle,
  ecrituresMouvement,
  ecrituresPartieDouble,
  ecrituresReglementCharge,
  ecrituresVente,
  ecrituresVersement,
  splitCaisseDepenseAgainstManual,
  totaux,
  type EcritureComptable,
} from "@/lib/journal-comptable-calc";
import { COMPTE_CHARGE_MANUELLE, COMPTES, compteDepense } from "@/lib/plan-comptable";
import { listAcquisitionsSansCaisse, sumAmortissementsByDate } from "@/lib/immobilisations-repo";
import { getParametres } from "@/lib/parametres-repo";
import { sumPertesCost } from "@/lib/pertes-repo";
import { listChargesManuellesByDateRange } from "@/lib/synthese-repo";
import { getDb } from "@/lib/mongodb";
import { valueMatieresConsumed } from "@/lib/matieres-calc";
import type { MatieresLine, MatieresMovement, VenteSite } from "@/lib/types";
import { listVentesHistory } from "@/lib/ventes-history-repo";
import { isValidDate } from "@/lib/day-doc";

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
    const lignes = t.lines;
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

  const { consumedParJour, achatsSansCaisse } = await loadMatieresJournal(
    input.from,
    input.to,
    input.scopeSite,
  );
  const cmvVentes = await loadCmvFromVentes(
    input.from,
    input.to,
    input.scopeSite,
  );

  const postes = Object.keys(
    COMPTE_CHARGE_MANUELLE,
  ) as (keyof typeof COMPTE_CHARGE_MANUELLE)[];
  const manualBudget = new Map<string, number>();
  for (const charge of chargesManuelles) {
    for (const poste of postes) {
      if (
        poste === "matieresPremieres" &&
        (consumedParJour[charge.date] ?? 0) > 0
      ) {
        continue;
      }
      const montant = charge[poste];
      if (typeof montant === "number" && montant > 0) {
        const numero = COMPTE_CHARGE_MANUELLE[poste].numero;
        const key = `${charge.date}|${numero}`;
        manualBudget.set(key, (manualBudget.get(key) ?? 0) + montant);
      }
    }
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
    if (m.mouvement.kind === "depense") {
      const { compte } = compteDepense(m.mouvement.nature);
      const isOperatingCharge =
        compte.numero.startsWith("6") &&
        compte.numero !== COMPTES.ACHATS_MATIERES.numero;
      // Matching volontairement limité à date|compte (pas de depenseId).
      // Deux dépenses distinctes le même jour sur le même compte partagent
      // le budget manuel : évolution future = clé métier plus fine.
      const key = `${m.date}|${compte.numero}`;
      const remaining = isOperatingCharge ? (manualBudget.get(key) ?? 0) : 0;
      const { reglement, charge } = splitCaisseDepenseAgainstManual({
        montant: m.mouvement.montant,
        alreadyCharged: remaining,
      });
      if (reglement > 0) {
        ecritures.push(
          ...ecrituresReglementCharge({
            date: m.date,
            piece: m.mouvement.id,
            libelle: `Règlement charge · ${m.mouvement.nature}`,
            caisse: m.caisse,
            montant: reglement,
          }),
        );
        manualBudget.set(key, remaining - reglement);
      }
      if (charge > 0) {
        ecritures.push(
          ...ecrituresMouvement({
            date: m.date,
            caisse: m.caisse,
            mouvement: { ...m.mouvement, montant: charge },
          }),
        );
      }
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

  for (const charge of chargesManuelles) {
    for (const poste of postes) {
      if (
        poste === "matieresPremieres" &&
        (consumedParJour[charge.date] ?? 0) > 0
      ) {
        continue;
      }
      const montant = charge[poste];
      if (typeof montant === "number" && montant > 0) {
        ecritures.push(
          ...ecrituresChargeManuelle({ date: charge.date, poste, montant }),
        );
      }
    }
  }

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

  for (const [date, montant] of Object.entries(cmvVentes.boissons)) {
    ecritures.push(
      ...ecrituresPartieDouble({
        date,
        piece: `cmv-boissons-${date}`,
        libelle: "Consommation boissons (CMV)",
        debitCompte: COMPTES.ACHATS_BOISSONS,
        creditCompte: COMPTES.STOCK_BOISSONS,
        montant,
      }),
    );
  }

  for (const [date, montant] of Object.entries(cmvVentes.emballages)) {
    ecritures.push(
      ...ecrituresPartieDouble({
        date,
        piece: `cmv-emballages-${date}`,
        libelle: "Sortie d’emballages (CMV)",
        debitCompte: COMPTES.ACHATS_EMBALLAGES,
        creditCompte: COMPTES.STOCK_EMBALLAGES,
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

  const pertes = await sumPertesCost({
    from: input.from,
    to: input.to,
    site: input.scopeSite ?? "all",
  });
  for (const [date, montant] of Object.entries(pertes.parJour)) {
    if (montant <= 0) continue;
    ecritures.push(
      ...ecrituresPartieDouble({
        date,
        piece: `perte-${date}`,
        libelle: "Pertes d’exploitation",
        debitCompte: COMPTES.PERTES_STOCK,
        creditCompte: COMPTES.COMPTE_ATTENTE,
        montant,
        confiant: false,
      }),
    );
  }

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
      montant: 0,
      note:
        pertes.total > 0
          ? "Les pertes (toutes familles) sont passées en 6582, même source que le compte de résultat."
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
  achatsSansCaisse: { id: string; date: string; name: string; montant: number }[];
}> {
  const consumedParJour: Record<string, number> = {};
  const achatsSansCaisse: {
    id: string;
    date: string;
    name: string;
    montant: number;
  }[] = [];
  if (scopeSite) {
    return { consumedParJour, achatsSansCaisse };
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
    const consumed = valueMatieresConsumed(
      doc.lines,
      doc.movements,
      priceById,
    );
    if (consumed > 0) consumedParJour[doc._id] = consumed;

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

  return { consumedParJour, achatsSansCaisse };
}

async function loadCmvFromVentes(
  from: string,
  to: string,
  scopeSite?: VenteSite | null,
): Promise<{
  boissons: Record<string, number>;
  emballages: Record<string, number>;
}> {
  const boissons: Record<string, number> = {};
  const emballages: Record<string, number> = {};
  const db = await getDb();
  const match: Record<string, unknown> = {
    date: { $gte: from, $lte: to },
    cancelledAt: null,
    caExcluded: { $ne: true },
    kind: { $in: ["boisson", "extra"] },
  };
  if (scopeSite) match.site = scopeSite;
  const rows = await db
    .collection("ventes_log")
    .aggregate<{ _id: { date: string; kind: string }; cost: number }>([
      { $match: match },
      {
        $group: {
          _id: { date: "$date", kind: "$kind" },
          cost: {
            $sum: {
              $multiply: [
                { $ifNull: ["$qty", 0] },
                { $ifNull: ["$costPrice", 0] },
              ],
            },
          },
        },
      },
    ])
    .toArray();
  for (const row of rows) {
    const cost = Math.max(0, Math.round(Number(row.cost) || 0));
    if (cost <= 0) continue;
    if (row._id.kind === "boisson") {
      boissons[row._id.date] = (boissons[row._id.date] ?? 0) + cost;
    } else if (row._id.kind === "extra") {
      emballages[row._id.date] = (emballages[row._id.date] ?? 0) + cost;
    }
  }
  return { boissons, emballages };
}
