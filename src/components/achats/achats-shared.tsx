"use client";

import { formatFcfa } from "@/lib/format";
import type { MatieresMovement } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export type StockPayload = {
  day: import("@/lib/types").MatieresDay;
  materials: import("@/lib/types").RawMaterial[];
  depense?: { id: string; montant: number } | null;
  depenseWarning?: string | null;
};

export type DraftRow = {
  qty: string;
  price: string;
  fournisseurId: string;
};

export type DraftLibre = {
  name: string;
  qty: string;
  price: string;
  fournisseurId: string;
  /** Date de l'achat (YYYY-MM-DD) — saisie par l'utilisateur, jamais déduite
   *  d'une date de page affichée ailleurs à l'écran. */
  date: string;
};

export function emptyDraft(): DraftRow {
  return { qty: "", price: "", fournisseurId: "" };
}

export function emptyDraftLibre(date: string = todayIsoDate()): DraftLibre {
  return { name: "", qty: "", price: "", fournisseurId: "", date };
}

/** Date seule, sans heure — l'heure de saisie n'intéresse personne ici. */
export function formatDateFr(dateIso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(`${dateIso}T12:00:00`));
  } catch {
    return dateIso;
  }
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Mouvements mis à plat pour Excel, chacun avec sa date de saisie. Les
 * mouvements annulés restent listés : un registre qui efface ses lignes ne se
 * contrôle pas — la colonne Statut les distingue.
 */
export function movementRows(
  entries: Array<{ date: string; movement: MatieresMovement }>,
): Array<Record<string, string | number>> {
  return entries.map(({ date, movement: m }) => ({
    Date: date,
    Produit: m.name,
    Fournisseur: m.fournisseurNom ?? "",
    Quantité: m.qty,
    "PU (FCFA)": m.unitPrice,
    "Montant (FCFA)": m.qty * m.unitPrice,
    Statut: m.cancelledAt ? "Annulé" : m.editedAt ? "Corrigé" : "Validé",
  }));
}

/**
 * Une ligne du registre d'achats (lecture seule).
 * Modification et annulation ne sont plus proposées une fois l'achat enregistré.
 */
export function MovementRow({
  m,
  dayDate,
  showAmount = false,
}: {
  m: MatieresMovement;
  dayDate: string;
  showAmount?: boolean;
}) {
  return (
    <li className={m.cancelledAt ? "is-cancelled" : undefined}>
      <div>
        <strong>
          +{m.qty} × {m.name}
        </strong>
        {m.unitPrice > 0 ? (
          <span className="muted">
            {" "}
            ({formatFcfa(m.unitPrice)} / u
            {showAmount ? ` — ${formatFcfa(m.qty * m.unitPrice)}` : ""})
          </span>
        ) : null}
        <div className="vente-log-time muted">
          {formatDateFr(dayDate)}
          {m.fournisseurNom ? ` · ${m.fournisseurNom}` : ""}
          {m.depenseId ? " · dépense liée" : ""}
          {m.editedAt ? " · corrigé" : ""}
          {m.cancelledAt ? " · annulé" : ""}
        </div>
      </div>
    </li>
  );
}
