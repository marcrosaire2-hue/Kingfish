"use client";

import { formatFcfa } from "@/lib/format";
import type { Fournisseur, MatieresMovement } from "@/lib/types";
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
 * Une ligne du registre : affichage, ou formulaire de correction quand la
 * ligne est en édition. Partagée entre les écrans d'achats : les deux pages
 * listent et corrigent des mouvements de la même façon, seul le filtre par
 * type diffère.
 *
 * `allowDateEdit` n'a de sens que pour un achat libre : un achat de
 * catalogue touche le compteur `purchases` de sa matière pour SON jour — le
 * déplacer casserait le stock de la journée d'origine.
 */
export function MovementRow({
  m,
  dayDate,
  fournisseurs,
  busyId,
  editing,
  draftEdit,
  onDraftChange,
  onStartEdit,
  onStopEdit,
  onSubmitEdit,
  onCancelMovement,
  showAmount = false,
  allowDateEdit = false,
}: {
  m: MatieresMovement;
  dayDate: string;
  fournisseurs: Fournisseur[];
  busyId: string | null;
  editing: boolean;
  draftEdit: DraftLibre;
  onDraftChange: (patch: Partial<DraftLibre>) => void;
  onStartEdit: (m: MatieresMovement, dayDate: string) => void;
  onStopEdit: () => void;
  onSubmitEdit: (m: MatieresMovement, dayDate: string) => void;
  onCancelMovement: (m: MatieresMovement, dayDate: string) => void;
  showAmount?: boolean;
  allowDateEdit?: boolean;
}) {
  const busy = busyId === `edit-${m.id}` || busyId === `cancel-${m.id}`;

  if (editing) {
    return (
      <li className="achat-edit-row">
        <div className="achat-edit-form">
          {m.type === "autre" ? (
            <label className="vente-field">
              <span>Produit</span>
              <input
                value={draftEdit.name}
                onChange={(e) => onDraftChange({ name: e.target.value })}
                placeholder="Nom du produit"
              />
            </label>
          ) : (
            <div className="vente-field vente-field-static">
              <span>Matière</span>
              <strong>{m.name}</strong>
            </div>
          )}
          {allowDateEdit ? (
            <label className="vente-field">
              <span>Date de l&apos;achat</span>
              <input
                type="date"
                value={draftEdit.date}
                max={todayIsoDate()}
                onChange={(e) => onDraftChange({ date: e.target.value })}
              />
            </label>
          ) : null}
          <label className="vente-field">
            <span>Quantité</span>
            <input
              inputMode="decimal"
              value={draftEdit.qty}
              onChange={(e) => onDraftChange({ qty: e.target.value })}
            />
          </label>
          <label className="vente-field">
            <span>Prix unitaire</span>
            <input
              inputMode="decimal"
              value={draftEdit.price}
              onChange={(e) => onDraftChange({ price: e.target.value })}
            />
          </label>
          <label className="vente-field">
            <span>Fournisseur</span>
            <select
              value={draftEdit.fournisseurId}
              onChange={(e) => onDraftChange({ fournisseurId: e.target.value })}
            >
              <option value="">Fournisseur…</option>
              {fournisseurs.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nom}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="achat-edit-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => onSubmitEdit(m, dayDate)}
          >
            {busy ? "…" : "Enregistrer"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={onStopEdit}
          >
            Abandonner
          </button>
        </div>
      </li>
    );
  }

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
      {!m.cancelledAt ? (
        <div className="achat-row-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => onStartEdit(m, dayDate)}
          >
            Modifier
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => onCancelMovement(m, dayDate)}
          >
            Annuler
          </button>
        </div>
      ) : null}
    </li>
  );
}
