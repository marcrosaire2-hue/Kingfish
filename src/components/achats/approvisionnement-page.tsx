"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import { downloadExcel, excelFilename } from "@/lib/export-excel";
import { formatFcfa } from "@/lib/format";
import { computeMatieresDay } from "@/lib/matieres-calc";
import type { Fournisseur, MatieresDay, MatieresMovement, RawMaterial } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import { BrandLoader } from "@/components/brand-loader";
import {
  MovementRow,
  addDays,
  emptyDraft,
  emptyDraftLibre,
  movementRows,
  type DraftLibre,
  type DraftRow,
  type StockPayload,
} from "@/components/achats/achats-shared";

/** Achats du catalogue : tout mouvement qui n'est pas un achat libre. */
function isCatalogue(m: MatieresMovement): boolean {
  return m.type !== "autre";
}

/**
 * Approvisionnement : le catalogue des matières, leur stock, et l'achat
 * rattaché à une matière précise. Les achats hors catalogue (divers,
 * imprévus) vivent sur la page Achats — les deux partagent le même registre
 * en base, filtré ici par type pour ne montrer que ce qui touche le stock.
 */
export function ApprovisionnementPage() {
  const [date, setDate] = useState(() => todayIsoDate());
  const [day, setDay] = useState<MatieresDay | null>(null);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [draftBuy, setDraftBuy] = useState<Record<string, DraftRow>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Achat en cours de correction — un seul à la fois, registre ou historique. */
  const [editId, setEditId] = useState<string | null>(null);
  const [draftEdit, setDraftEdit] = useState<DraftLibre>(() => emptyDraftLibre());
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [search, setSearch] = useState("");
  const [historique, setHistorique] = useState<
    Array<{ date: string; movement: MatieresMovement }>
  >([]);
  // 30 jours par défaut : sur 7 jours, un achat saisi pour une date un peu
  // ancienne sortait de la plage et semblait perdu.
  const [historiqueRange, setHistoriqueRange] = useState(30);
  const [flash, setFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canManagePast, setCanManagePast] = useState(false);

  async function loadStock(nextDate = date) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/matieres?date=${encodeURIComponent(nextDate)}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as StockPayload & {
        error?: string;
        canManagePast?: boolean;
        backdate?: boolean;
      };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setMaterials(body.materials);
      setDraftBuy({});
      setCanManagePast(Boolean(body.canManagePast));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setDay(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStock(date), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

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

  // Historique multi-jours : mouvements aplatis sur la plage choisie.
  useEffect(() => {
    let annule = false;
    void (async () => {
      try {
        const from = addDays(todayIsoDate(), -(historiqueRange - 1));
        const res = await fetch(
          `/api/matieres?from=${encodeURIComponent(from)}&to=${encodeURIComponent(todayIsoDate())}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          historique?: Array<{ date: string; movement: MatieresMovement }>;
        };
        if (!annule) setHistorique(body.historique ?? []);
      } catch {
        /* silencieux : le registre du jour reste consultable */
      }
    })();
    return () => {
      annule = true;
    };
  }, [historiqueRange]);

  const computed = useMemo(() => {
    if (!day) return null;
    return computeMatieresDay(day, materials);
  }, [day, materials]);

  const filteredLines = useMemo(() => {
    if (!computed) return [];
    const q = search.trim().toLowerCase();
    if (!q) return computed.lines;
    return computed.lines.filter((l) => l.name.toLowerCase().includes(q));
  }, [computed, search]);

  const catalogMovements = useMemo(
    () => (day?.movements ?? []).filter(isCatalogue),
    [day],
  );

  const catalogHistorique = useMemo(
    () => historique.filter(({ movement }) => isCatalogue(movement)),
    [historique],
  );

  function patchDraft(productId: string, patch: Partial<DraftRow>) {
    setDraftBuy((d) => {
      const row = d[productId] ?? emptyDraft();
      return { ...d, [productId]: { ...row, ...patch } };
    });
  }

  async function submitPurchase(
    productId: string,
    fallbackPrice: number,
    row: DraftRow,
  ) {
    const qty = Number(String(row.qty).replace(",", ".")) || 0;
    if (qty <= 0) return;
    const price =
      Number(String(row.price).replace(",", ".")) ||
      Number(fallbackPrice) ||
      0;
    if (price <= 0) {
      setError(
        `Prix d'achat obligatoire pour cet achat : saisissez le prix unitaire.`,
      );
      return;
    }
    setBusyId(`buy-${productId}`);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/matieres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          productId,
          qty,
          unitPrice: price,
          fournisseurId: row.fournisseurId || undefined,
        }),
      });
      const body = (await res.json()) as StockPayload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setMaterials(body.materials);
      setDraftBuy((d) => ({ ...d, [productId]: emptyDraft() }));
      if (body.depense) {
        setFlash(
          `Achat enregistré — dépense de ${formatFcfa(body.depense.montant)} créée à la caisse.`,
        );
      } else {
        setFlash("Achat enregistré — caisse fermée : aucune dépense liée.");
      }
      reloadHistorique();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  function reloadHistorique() {
    void (async () => {
      try {
        const from = addDays(todayIsoDate(), -(historiqueRange - 1));
        const res = await fetch(
          `/api/matieres?from=${encodeURIComponent(from)}&to=${encodeURIComponent(todayIsoDate())}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          historique?: Array<{ date: string; movement: MatieresMovement }>;
        };
        setHistorique(body.historique ?? []);
      } catch {
        /* silencieux */
      }
    })();
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
          fournisseurId: draftEdit.fournisseurId || undefined,
        }),
      });
      const body = (await res.json()) as StockPayload & {
        error?: string;
        depense?: { id: string; montant: number } | null;
        depenseWarning?: string | null;
      };
      if (!res.ok) throw new Error(body.error || "Erreur");
      if (dayDate === date) {
        setDay(body.day);
        setMaterials(body.materials);
      }
      setEditId(null);
      if (body.depenseWarning) setFlash(body.depenseWarning);
      else if (body.depense) {
        setFlash(
          `Achat corrigé — dépense de caisse ramenée à ${formatFcfa(body.depense.montant)}.`,
        );
      } else setFlash("Achat corrigé.");
      reloadHistorique();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelMovement(m: MatieresMovement, dayDate: string) {
    if (!window.confirm(`Annuler cet achat de stock ?\n\n+${m.qty} × ${m.name}`)) {
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
      if (dayDate === date) {
        setDay(body.day);
        setMaterials(body.materials);
      }
      if (body.depenseWarning) setFlash(body.depenseWarning);
      else setFlash("Achat annulé.");
      reloadHistorique();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  // Groupes de l'historique par jour, du plus récent au plus ancien.
  const historyByDay = useMemo(() => {
    const groups = new Map<string, Array<{ movement: MatieresMovement }>>();
    for (const { date: d, movement } of catalogHistorique) {
      const list = groups.get(d) ?? [];
      list.push({ movement });
      groups.set(d, list);
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [catalogHistorique]);

  /** Jours récents portant des achats, hors date affichée — repère quand le
   *  registre du jour est vide alors que des achats existent ailleurs. */
  const derniersJoursAvecAchats = useMemo(
    () =>
      historyByDay
        .filter(([d]) => d !== date)
        .slice(0, 4)
        .map(([d, entries]) => [d, entries.length] as const),
    [historyByDay, date],
  );

  return (
    <AppShell
      title="Approvisionnement"
      subtitle="Matières du catalogue uniquement. Les achats hors catalogue se saisissent dans Achats."
      actions={
        <>
          <Link href="/achats" className="btn btn-ghost">
            Achats libres
          </Link>
          <ExportExcelButton
            disabled={loading || !computed}
            onExport={() => {
              if (!computed) return Promise.resolve();
              downloadExcel(excelFilename("approvisionnement", date), [
                {
                  name: "Achats du jour",
                  subtitle: date,
                  rows: movementRows(
                    catalogMovements.map((movement) => ({ date, movement })),
                  ),
                },
                {
                  name: "Historique",
                  subtitle: `${historiqueRange} derniers jours`,
                  rows: movementRows(catalogHistorique),
                },
                {
                  name: "Stock",
                  rows: computed.lines.map((l) => ({
                    Matière: l.name,
                    Unité: l.unit,
                    Initial: l.initialStock,
                    Achats: l.purchases,
                    Stock: l.stock,
                  })),
                },
              ]);
              return Promise.resolve();
            }}
          />
        </>
      }
    >
      <ContextBar date={date} onDateChange={setDate} />

      {canManagePast && date < todayIsoDate() ? (
        <p className="ui-info" role="status">
          Correction du {date.slice(8)}/{date.slice(5, 7)} — achats et stock
          matières autorisés même si la journée est clôturée.
        </p>
      ) : null}

      {error ? <p className="error-banner" role="alert">{error}</p> : null}
      {flash ? <p className="ui-info" role="status">{flash}</p> : null}

      {!loading && computed ? (
        <div className="dash-kpi-grid achats-kpi-grid">
          <div className="dash-kpi dash-kpi-accent">
            <span className="dash-kpi-label">Achats du jour</span>
            <span className="dash-kpi-value">
              {formatFcfa(
                catalogMovements
                  .filter((m) => !m.cancelledAt)
                  .reduce((s, m) => s + m.qty * m.unitPrice, 0),
              )}
            </span>
          </div>
          <div className="dash-kpi">
            <span className="dash-kpi-label">Achats enregistrés</span>
            <span className="dash-kpi-value">
              {catalogMovements.filter((m) => !m.cancelledAt).length}
            </span>
          </div>
          <div
            className={`dash-kpi${computed.alerts.length > 0 ? " dash-kpi-warn" : ""}`}
          >
            <span className="dash-kpi-label">Alertes stock</span>
            <span className="dash-kpi-value">{computed.alerts.length}</span>
          </div>
        </div>
      ) : null}

      {loading || !day || !computed ? (
        <BrandLoader variant="ligne" label="Chargement de l'approvisionnement…" />
      ) : materials.length === 0 ? (
        <p className="ui-info">
          Aucune matière définie. Ajoutez-les dans Paramètres → Matières.
        </p>
      ) : (
        <>
          <div className="vente-field" style={{ maxWidth: "24rem" }}>
            <label htmlFor="recherche-matiere">Rechercher une matière</label>
            <input
              id="recherche-matiere"
              type="search"
              placeholder="Nom de la matière…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <section className="panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Matière</th>
                  <th className="col-num">Stock</th>
                  <th className="col-num">Achats jour</th>
                  <th>Nouvel achat</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.map((line) => {
                  const mat = materials.find((m) => m.id === line.productId);
                  const row = draftBuy[line.productId] ?? emptyDraft();
                  return (
                    <tr key={line.productId}>
                      <td>
                        <strong>{line.name}</strong>
                        {line.unit ? (
                          <span className="muted"> · {line.unit}</span>
                        ) : null}
                        {line.stock <= 0 ? (
                          <span className="vente-out-badge vente-out-badge-inline">
                            ÉPUISÉ
                          </span>
                        ) : line.belowThreshold ? (
                          <span className="vente-low-badge vente-low-badge-inline">
                            Bientôt épuisé
                          </span>
                        ) : null}
                      </td>
                      <td className="col-num mono">{line.stock}</td>
                      <td className="col-num mono">{line.purchases}</td>
                      <td>
                        <div className="inline-buy inline-buy-achats">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            className="input-num"
                            placeholder="Qté"
                            value={row.qty}
                            onChange={(e) =>
                              patchDraft(line.productId, { qty: e.target.value })
                            }
                            aria-label={`Quantité à acheter ${line.name}`}
                          />
                          <input
                            type="number"
                            min={0}
                            step="any"
                            className="input-num"
                            placeholder={
                              mat?.purchasePrice
                                ? `Prix (${mat.purchasePrice})`
                                : "Prix / u"
                            }
                            value={row.price}
                            onChange={(e) =>
                              patchDraft(line.productId, { price: e.target.value })
                            }
                            aria-label={`Prix d'achat unitaire ${line.name}`}
                          />
                          {fournisseurs.length > 0 ? (
                            <select
                              className="input-select"
                              value={row.fournisseurId}
                              onChange={(e) =>
                                patchDraft(line.productId, {
                                  fournisseurId: e.target.value,
                                })
                              }
                              aria-label={`Fournisseur ${line.name}`}
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
                            disabled={busyId === `buy-${line.productId}`}
                            onClick={() =>
                              void submitPurchase(
                                line.productId,
                                mat?.purchasePrice ?? 0,
                                row,
                              )
                            }
                          >
                            + Achat
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredLines.length === 0 ? (
              <p className="muted">Aucune matière ne correspond à « {search} ».</p>
            ) : null}
          </section>

          <section className="panel">
            <h2 className="panel-title">Registre des achats de stock</h2>
            {catalogMovements.length === 0 ? (
              <>
                <p className="muted">Aucun achat saisi pour le {date}.</p>
                {/* Un achat saisi pour une autre date n'est pas perdu : on dit
                    où il est, au lieu de laisser un registre vide. */}
                {derniersJoursAvecAchats.length > 0 ? (
                  <p className="ui-info">
                    Derniers achats enregistrés :{" "}
                    {derniersJoursAvecAchats.map(([d, n], i) => (
                      <span key={d}>
                        {i > 0 ? " · " : ""}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setDate(d)}
                        >
                          {d} ({n})
                        </button>
                      </span>
                    ))}
                  </p>
                ) : null}
              </>
            ) : (
              <ul className="vente-log">
                {catalogMovements.map((m) => (
                  <MovementRow
                    key={m.id}
                    m={m}
                    dayDate={date}
                    fournisseurs={fournisseurs}
                    busyId={busyId}
                    editing={editId === m.id}
                    draftEdit={draftEdit}
                    onDraftChange={(patch) =>
                      setDraftEdit((d) => ({ ...d, ...patch }))
                    }
                    onStartEdit={startEdit}
                    onStopEdit={() => setEditId(null)}
                    onSubmitEdit={(mv, d) => void submitEdit(mv, d)}
                    onCancelMovement={(mv, d) => void cancelMovement(mv, d)}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Historique des achats</h2>
              <select
                className="input-select"
                value={historiqueRange}
                onChange={(e) => setHistoriqueRange(Number(e.target.value))}
                aria-label="Plage de l'historique"
              >
                <option value={7}>7 derniers jours</option>
                <option value={30}>30 derniers jours</option>
                <option value={90}>90 derniers jours</option>
              </select>
            </div>
            {catalogHistorique.length === 0 ? (
              <p className="muted">Aucun achat sur cette période.</p>
            ) : (
              historyByDay.map(([d, entries]) => (
                <div key={d} className="history-day">
                  <h3 className="history-day-title">{d}</h3>
                  <ul className="vente-log">
                    {entries.map(({ movement: m }) => (
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
                      />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
