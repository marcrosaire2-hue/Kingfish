"use client";

import { formatFcfa } from "@/lib/format";
import type { Fournisseur, MatieresMovement } from "@/lib/types";

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
};

export function emptyDraft(): DraftRow {
  return { qty: "", price: "", fournisseurId: "" };
}

export function emptyDraftLibre(): DraftLibre {
  return { name: "", qty: "", price: "", fournisseurId: "" };
}

export function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Mouvements mis à plat pour Excel. Les mouvements annulés restent listés :
 * un registre qui efface ses lignes ne se contrôle pas — la colonne Statut
 * les distingue.
 */
export function movementRows(
  movements: MatieresMovement[],
): Array<Record<string, string | number>> {
  return movements.map((m) => ({
    Heure: formatTime(m.at),
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
 * ligne est en édition. Le registre du jour et l'historique partagent la même
 * ligne — corriger un achat de la veille doit se faire au même endroit qu'on
 * le lit. Partagée entre Approvisionnement (achats catalogue) et Achats
 * (achats libres) : les deux pages listent et corrigent des mouvements de la
 * même façon, seul le filtre par type diffère.
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
}: {
  m: MatieresMovement;
  dayDate: string;
  fournisseurs: Fournisseur[];
  busyId: string | null;
  editing: boolean;
  draftEdit: DraftLibre;
  onDraftChange: (patch: Partial<DraftLibre>) => void;
  onStartEdit: (m: MatieresMovement) => void;
  onStopEdit: () => void;
  onSubmitEdit: (m: MatieresMovement, dayDate: string) => void;
  onCancelMovement: (m: MatieresMovement, dayDate: string) => void;
  showAmount?: boolean;
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
          {formatTime(m.at)}
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
            onClick={() => onStartEdit(m)}
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
