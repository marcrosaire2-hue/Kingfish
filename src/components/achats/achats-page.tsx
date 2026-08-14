"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import {
  downloadExcel,
  excelFilename,
} from "@/lib/export-excel";
import { formatFcfa } from "@/lib/format";
import { computeMatieresDay } from "@/lib/matieres-calc";
import type {
  Fournisseur,
  MatieresDay,
  MatieresMovement,
  RawMaterial,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import { BrandLoader } from "@/components/brand-loader";

type StockPayload = {
  day: MatieresDay;
  materials: RawMaterial[];
  depense?: { id: string; montant: number } | null;
  depenseWarning?: string | null;
};

type DraftRow = {
  qty: string;
  price: string;
  fournisseurId: string;
};

type DraftLibre = {
  name: string;
  qty: string;
  price: string;
  fournisseurId: string;
};

function emptyDraft(): DraftRow {
  return { qty: "", price: "", fournisseurId: "" };
}

function emptyDraftLibre(): DraftLibre {
  return { name: "", qty: "", price: "", fournisseurId: "" };
}

function formatTime(iso: string): string {
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

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function AchatsPage() {
  const [date, setDate] = useState(() => todayIsoDate());
  const [day, setDay] = useState<MatieresDay | null>(null);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [draftBuy, setDraftBuy] = useState<Record<string, DraftRow>>({});
  const [draftLibre, setDraftLibre] = useState<DraftLibre>(() => emptyDraftLibre());
  const [busyLibre, setBusyLibre] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [search, setSearch] = useState("");
  const [historique, setHistorique] = useState<
    Array<{ date: string; movement: MatieresMovement }>
  >([]);
  const [historiqueRange, setHistoriqueRange] = useState(7);
  const [flash, setFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadStock(nextDate = date) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/matieres?date=${encodeURIComponent(nextDate)}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as StockPayload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setMaterials(body.materials);
      setDraftBuy({});
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
    return computed.lines.filter((l) =>
      l.name.toLowerCase().includes(q),
    );
  }, [computed, search]);

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

  async function submitPurchaseLibre(row: DraftLibre) {
    const name = row.name.trim();
    const qty = Number(String(row.qty).replace(",", ".")) || 0;
    const price = Number(String(row.price).replace(",", ".")) || 0;
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
          date,
          productId: "autre",
          name,
          qty,
          unitPrice: price,
          fournisseurId: row.fournisseurId || undefined,
        }),
      });
      const body = (await res.json()) as StockPayload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setMaterials(body.materials);
      setDraftLibre(emptyDraftLibre());
      if (body.depense) {
        setFlash(
          `Achat libre enregistré — dépense de ${formatFcfa(body.depense.montant)} créée à la caisse.`,
        );
      } else {
        setFlash("Achat libre enregistré — caisse fermée : aucune dépense liée.");
      }
      reloadHistorique();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyLibre(false);
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
    for (const { date: d, movement } of historique) {
      const list = groups.get(d) ?? [];
      list.push({ movement });
      groups.set(d, list);
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [historique]);

  return (
    <AppShell
      title="Achats"
      subtitle="Entrées de stock matières"
      actions={
        <ExportExcelButton
          disabled={loading || !computed}
          onExport={() => {
            if (!computed) return Promise.resolve();
            downloadExcel(excelFilename("achats-stock", date), [
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
      }
    >
      <ContextBar date={date} onDateChange={setDate} />

      {error ? <p className="error-banner" role="alert">{error}</p> : null}
      {flash ? <p className="ui-info" role="status">{flash}</p> : null}

      {!loading && computed ? (
        <div className="dash-kpi-grid achats-kpi-grid">
          <div className="dash-kpi dash-kpi-accent">
            <span className="dash-kpi-label">Achats du jour</span>
            <span className="dash-kpi-value">
              {formatFcfa(
                (day?.movements ?? [])
                  .filter((m) => !m.cancelledAt)
                  .reduce((s, m) => s + m.qty * m.unitPrice, 0),
              )}
            </span>
          </div>
          <div className="dash-kpi">
            <span className="dash-kpi-label">Achats enregistrés</span>
            <span className="dash-kpi-value">
              {(day?.movements ?? []).filter((m) => !m.cancelledAt).length}
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
        <BrandLoader variant="ligne" label="Chargement des achats…" />
      ) : materials.length === 0 ? (
        <p className="ui-info">
          Aucune matière définie. Ajoutez-les dans Paramètres → Matières.
        </p>
      ) : (
        <>
          <section className="panel">
            <h2 className="panel-title">Achat libre (hors liste)</h2>
            <div className="libre-buy">
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
                + Achat libre
              </button>
            </div>
            <p className="muted libre-hint">
              Pour un produit absent de la liste ci-dessous : écrivez ce que
              vous achetez, la quantité et le prix. L&apos;achat sera enregistré
              au registre du jour sans toucher au compteur de stock.
            </p>
          </section>

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
                  const mat = materials.find(
                    (m) => m.id === line.productId,
                  );
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
            {(day.movements ?? []).length === 0 ? (
              <p className="muted">Aucun mouvement aujourd’hui.</p>
            ) : (
              <ul className="vente-log">
                {(day.movements ?? []).map((m) => (
                  <li
                    key={m.id}
                    className={m.cancelledAt ? "is-cancelled" : undefined}
                  >
                    <div>
                      <strong>
                        +{m.qty} × {m.name}
                      </strong>
                      {m.unitPrice > 0 ? (
                        <span className="muted">
                          {" "}
                          ({formatFcfa(m.unitPrice)} / u)
                        </span>
                      ) : null}
                      <div className="vente-log-time muted">
                        {formatTime(m.at)}
                        {m.fournisseurNom ? ` · ${m.fournisseurNom}` : ""}
                        {m.depenseId ? " · dépense liée" : ""}
                        {m.cancelledAt ? " · annulé" : ""}
                      </div>
                    </div>
                    {!m.cancelledAt ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busyId === `cancel-${m.id}`}
                        onClick={() => void cancelMovement(m, date)}
                      >
                        Annuler
                      </button>
                    ) : null}
                  </li>
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
            {historique.length === 0 ? (
              <p className="muted">
                Aucun achat sur cette période.
              </p>
            ) : (
              historyByDay.map(([d, entries]) => (
                <div key={d} className="history-day">
                  <h3 className="history-day-title">{d}</h3>
                  <ul className="vente-log">
                    {entries.map(({ movement: m }) => (
                      <li
                        key={m.id}
                        className={m.cancelledAt ? "is-cancelled" : undefined}
                      >
                        <div>
                          <strong>
                            +{m.qty} × {m.name}
                          </strong>
                          {m.unitPrice > 0 ? (
                            <span className="muted">
                              {" "}
                              ({formatFcfa(m.unitPrice)} / u —{" "}
                              {formatFcfa(m.qty * m.unitPrice)})
                            </span>
                          ) : null}
                          <div className="vente-log-time muted">
                            {formatTime(m.at)}
                            {m.fournisseurNom ? ` · ${m.fournisseurNom}` : ""}
                            {m.depenseId ? " · dépense liée" : ""}
                            {m.cancelledAt ? " · annulé" : ""}
                          </div>
                        </div>
                        {!m.cancelledAt ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busyId === `cancel-${m.id}`}
                            onClick={() => void cancelMovement(m, d)}
                          >
                            Annuler
                          </button>
                        ) : null}
                      </li>
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
