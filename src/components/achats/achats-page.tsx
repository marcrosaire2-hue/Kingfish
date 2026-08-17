"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import { downloadExcel, excelFilename } from "@/lib/export-excel";
import { formatFcfa } from "@/lib/format";
import type { Fournisseur, MatieresMovement } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import { BrandLoader } from "@/components/brand-loader";
import {
  MovementRow,
  emptyDraftLibre,
  movementRows,
  type DraftLibre,
  type StockPayload,
} from "@/components/achats/achats-shared";

/** Achats libres : tout ce qui n'est pas une matière du catalogue. */
function isLibre(m: MatieresMovement): boolean {
  return m.type === "autre";
}

// Bornes larges plutôt qu'un sélecteur de plage : la page montre tous les
// achats libres, sans notion de « jour affiché ». +1 an couvre une saisie
// datée par erreur dans le futur sans la rendre invisible.
const RANGE_FROM = "2020-01-01";

/**
 * Achats libres (hors catalogue) : imprévus, divers, dépannage — un produit
 * qui n'a pas de fiche matière. Chaque achat porte sa propre date, choisie à
 * la saisie : rien ici ne dépend d'une date de page affichée ailleurs, qui
 * avait fait atterrir des achats sous de mauvaises dates par le passé. Les
 * achats de matières, eux, se saisissent sur Approvisionnement.
 */
export function AchatsPage() {
  const [entries, setEntries] = useState<
    Array<{ date: string; movement: MatieresMovement }>
  >([]);
  const [draftLibre, setDraftLibre] = useState<DraftLibre>(() =>
    emptyDraftLibre(),
  );
  const [busyLibre, setBusyLibre] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Achat en cours de correction — un seul à la fois. */
  const [editId, setEditId] = useState<string | null>(null);
  const [draftEdit, setDraftEdit] = useState<DraftLibre>(() =>
    emptyDraftLibre(),
  );
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const to = todayIsoDate();
        const res = await fetch(
          `/api/matieres?from=${encodeURIComponent(RANGE_FROM)}&to=${encodeURIComponent(to)}`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as {
          historique?: Array<{ date: string; movement: MatieresMovement }>;
          error?: string;
        };
        if (!res.ok) throw new Error(body.error || "Erreur");
        setEntries((body.historique ?? []).filter(({ movement }) => isLibre(movement)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur");
      } finally {
        setLoading(false);
      }
    })();
  }

  useEffect(() => {
    reload();
  }, []);

  // Fournisseurs proposés à la saisie : gérés dans Réglages.
  useEffect(() => {
    let annule = false;
    void (async () => {
      try {
        const res = await fetch("/api/pos-config", { cache: "no-store" });
        if (!res.ok) return;
        const config = (await res.json()) as { fournisseurs?: Fournisseur[] };
        if (!annule) setFournisseurs(config.fournisseurs ?? []);
      } catch {
        /* la saisie d'achat reste possible sans fournisseur */
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

  // Plus récent en premier.
  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.date.localeCompare(a.date)),
    [entries],
  );

  async function submitPurchaseLibre(row: DraftLibre) {
    const name = row.name.trim();
    const qty = Number(String(row.qty).replace(",", ".")) || 0;
    const price = Number(String(row.price).replace(",", ".")) || 0;
    if (!row.date) {
      setError("Choisissez la date de l'achat.");
      return;
    }
    if (name.length < 2) {
      setError("Saisissez le nom du produit acheté.");
      return;
    }
    if (qty <= 0 || price <= 0) {
      setError("Quantité et prix unitaire obligatoires pour un achat libre.");
      return;
    }
    setBusyLibre(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/matieres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: row.date,
          productId: "autre",
          name,
          qty,
          unitPrice: price,
          fournisseurId: row.fournisseurId || undefined,
        }),
      });
      const body = (await res.json()) as StockPayload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDraftLibre(emptyDraftLibre());
      if (body.depense) {
        setFlash(
          `Achat enregistré — dépense de ${formatFcfa(body.depense.montant)} créée à la caisse.`,
        );
      } else {
        setFlash("Achat enregistré — caisse fermée : aucune dépense liée.");
      }
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyLibre(false);
    }
  }

  function startEdit(m: MatieresMovement, dayDate: string) {
    setError(null);
    setFlash(null);
    setEditId(m.id);
    setDraftEdit({
      name: m.name,
      qty: String(m.qty),
      price: String(m.unitPrice),
      fournisseurId: m.fournisseurId ?? "",
      date: dayDate,
    });
  }

  async function submitEdit(m: MatieresMovement, dayDate: string) {
    const qty = Number(draftEdit.qty.replace(",", "."));
    const price = Number(draftEdit.price.replace(",", "."));
    if (!(qty > 0) || !(price > 0)) {
      setError("Quantité et prix unitaire obligatoires.");
      return;
    }
    if (!draftEdit.date) {
      setError("Choisissez la date de l'achat.");
      return;
    }
    setBusyId(`edit-${m.id}`);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/matieres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          date: dayDate,
          movementId: m.id,
          qty,
          unitPrice: price,
          name: draftEdit.name.trim(),
          fournisseurId: draftEdit.fournisseurId || undefined,
          newDate: draftEdit.date !== dayDate ? draftEdit.date : undefined,
        }),
      });
      const body = (await res.json()) as StockPayload & {
        error?: string;
        depense?: { id: string; montant: number } | null;
        depenseWarning?: string | null;
      };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setEditId(null);
      if (body.depenseWarning) setFlash(body.depenseWarning);
      else if (body.depense) {
        setFlash(
          `Achat corrigé — dépense de caisse ramenée à ${formatFcfa(body.depense.montant)}.`,
        );
      } else setFlash("Achat corrigé.");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelMovement(m: MatieresMovement, dayDate: string) {
    if (!window.confirm(`Annuler cet achat ?\n\n+${m.qty} × ${m.name}`)) {
      return;
    }
    setBusyId(`cancel-${m.id}`);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/matieres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          date: dayDate,
          movementId: m.id,
        }),
      });
      const body = (await res.json()) as StockPayload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      if (body.depenseWarning) setFlash(body.depenseWarning);
      else setFlash("Achat annulé.");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  const totalMontant = entries
    .filter(({ movement }) => !movement.cancelledAt)
    .reduce((s, { movement }) => s + movement.qty * movement.unitPrice, 0);
  const totalCount = entries.filter(({ movement }) => !movement.cancelledAt).length;

  return (
    <AppShell
      title="Achats"
      subtitle="Achats libres, hors catalogue de matières"
      actions={
        <ExportExcelButton
          disabled={loading}
          onExport={() => {
            downloadExcel(excelFilename("achats-libres", todayIsoDate()), [
              {
                name: "Achats",
                rows: movementRows(sorted),
              },
            ]);
            return Promise.resolve();
          }}
        />
      }
    >
      {error ? <p className="error-banner" role="alert">{error}</p> : null}
      {flash ? <p className="ui-info" role="status">{flash}</p> : null}

      {!loading ? (
        <div className="dash-kpi-grid achats-kpi-grid">
          <div className="dash-kpi dash-kpi-accent">
            <span className="dash-kpi-label">Total des achats</span>
            <span className="dash-kpi-value">{formatFcfa(totalMontant)}</span>
          </div>
          <div className="dash-kpi">
            <span className="dash-kpi-label">Achats enregistrés</span>
            <span className="dash-kpi-value">{totalCount}</span>
          </div>
        </div>
      ) : null}

      {loading ? (
        <BrandLoader variant="ligne" label="Chargement des achats…" />
      ) : (
        <>
          <section className="panel">
            <h2 className="panel-title">Nouvel achat libre</h2>
            <div className="libre-buy">
              <input
                type="date"
                className="input-text"
                value={draftLibre.date}
                max={todayIsoDate()}
                onChange={(e) =>
                  setDraftLibre((d) => ({ ...d, date: e.target.value }))
                }
                aria-label="Date de l'achat"
              />
              <input
                type="text"
                className="input-text"
                placeholder="Nom du produit…"
                value={draftLibre.name}
                onChange={(e) =>
                  setDraftLibre((d) => ({ ...d, name: e.target.value }))
                }
                aria-label="Nom du produit acheté"
              />
              <input
                type="number"
                min={0}
                step="any"
                className="input-num"
                placeholder="Qté"
                value={draftLibre.qty}
                onChange={(e) =>
                  setDraftLibre((d) => ({ ...d, qty: e.target.value }))
                }
                aria-label="Quantité achetée"
              />
              <input
                type="number"
                min={0}
                step="any"
                className="input-num"
                placeholder="Prix / u"
                value={draftLibre.price}
                onChange={(e) =>
                  setDraftLibre((d) => ({ ...d, price: e.target.value }))
                }
                aria-label="Prix unitaire"
              />
              {fournisseurs.length > 0 ? (
                <select
                  className="input-select"
                  value={draftLibre.fournisseurId}
                  onChange={(e) =>
                    setDraftLibre((d) => ({
                      ...d,
                      fournisseurId: e.target.value,
                    }))
                  }
                  aria-label="Fournisseur"
                >
                  <option value="">Fournisseur…</option>
                  {fournisseurs.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nom}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                className="btn btn-primary"
                disabled={busyLibre}
                onClick={() => void submitPurchaseLibre(draftLibre)}
              >
                + Achat
              </button>
            </div>
            <p className="muted libre-hint">
              Pour un produit qui n&apos;est pas une matière de stock : la
              date à laquelle l&apos;achat a réellement eu lieu, ce que vous
              achetez, la quantité et le prix. L&apos;achat est enregistré
              sans toucher au compteur de stock d&apos;Approvisionnement.
            </p>
          </section>

          <section className="panel">
            <h2 className="panel-title">Liste des achats</h2>
            {sorted.length === 0 ? (
              <p className="muted">Aucun achat libre enregistré.</p>
            ) : (
              <ul className="vente-log">
                {sorted.map(({ date: d, movement: m }) => (
                  <MovementRow
                    key={m.id}
                    m={m}
                    dayDate={d}
                    fournisseurs={fournisseurs}
                    busyId={busyId}
                    editing={editId === m.id}
                    draftEdit={draftEdit}
                    onDraftChange={(patch) =>
                      setDraftEdit((dr) => ({ ...dr, ...patch }))
                    }
                    onStartEdit={startEdit}
                    onStopEdit={() => setEditId(null)}
                    onSubmitEdit={(mv, dd) => void submitEdit(mv, dd)}
                    onCancelMovement={(mv, dd) => void cancelMovement(mv, dd)}
                    showAmount
                    allowDateEdit
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
