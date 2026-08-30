"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import {
  CataloguePaginationBar,
  CatalogueSkeleton,
} from "@/components/parametres/catalogue-view";
import "@/components/parametres/parametres-catalogue.css";
import { downloadExcel, excelFilename } from "@/lib/export-excel";
import { formatFcfa } from "@/lib/format";
import type { Fournisseur, MatieresMovement } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import {
  emptyDraftLibre,
  formatDateFr,
  movementRows,
  type DraftLibre,
  type StockPayload,
} from "@/components/achats/achats-shared";

/** Achats libres : tout ce qui n'est pas une matière du catalogue. */
function isLibre(m: MatieresMovement): boolean {
  return m.type === "autre";
}

const RANGE_FROM = "2020-01-01";
const PAGE_SIZE = 10;

type StatutFilter = "all" | "valide" | "corrige" | "annule";

function useDebouncedValue<T>(value: T, delayMs = 280): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
  };
}

function statutLabel(m: MatieresMovement): string {
  if (m.cancelledAt) return "Annulé";
  if (m.editedAt) return "Corrigé";
  return "Validé";
}

function statutKey(m: MatieresMovement): Exclude<StatutFilter, "all"> {
  if (m.cancelledAt) return "annule";
  if (m.editedAt) return "corrige";
  return "valide";
}

/**
 * Achats libres (hors catalogue). UI alignée sur la maquette SaaS ;
 * logique métier inchangée (POST /api/matieres, pas d’édition / annulation).
 */
export function AchatsPage() {
  const formRef = useRef<HTMLElement | null>(null);
  const productInputRef = useRef<HTMLInputElement | null>(null);

  const [entries, setEntries] = useState<
    Array<{ date: string; movement: MatieresMovement }>
  >([]);
  const [draftLibre, setDraftLibre] = useState<DraftLibre>(() =>
    emptyDraftLibre(),
  );
  const [busyLibre, setBusyLibre] = useState(false);
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statutFilter, setStatutFilter] = useState<StatutFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

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
        if (!res.ok) throw new Error(body.error || "Impossible de charger les achats.");
        setEntries(
          (body.historique ?? []).filter(({ movement }) => isLibre(movement)),
        );
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Impossible de charger les achats.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }

  useEffect(() => {
    reload();
  }, []);

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

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.date.localeCompare(a.date)),
    [entries],
  );

  const filtered = useMemo(() => {
    const q = normalizeSearch(debouncedSearch);
    return sorted.filter(({ date, movement: m }) => {
      if (statutFilter !== "all" && statutKey(m) !== statutFilter) return false;
      if (!q) return true;
      const blob = [m.name, m.fournisseurNom ?? "", date, statutLabel(m)].join(
        " ",
      );
      return normalizeSearch(blob).includes(q);
    });
  }, [sorted, debouncedSearch, statutFilter]);

  const paged = useMemo(
    () => paginate(filtered, page, PAGE_SIZE),
    [filtered, page],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statutFilter]);

  function focusNewPurchase() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => productInputRef.current?.focus(), 280);
  }

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

  const actifs = entries.filter(({ movement }) => !movement.cancelledAt);
  const totalMontant = actifs.reduce(
    (s, { movement }) => s + movement.qty * movement.unitPrice,
    0,
  );
  const totalCount = actifs.length;

  return (
    <AppShell
      title="Achats"
      subtitle="Hors catalogue uniquement. Les matières du catalogue se saisissent dans Approvisionnement. Les sorties de caisse liées restent dans Caisse."
      mainClassName="main-achats"
      actions={
        <>
          <Link href="/appro" className="btn btn-ghost achats-header-btn">
            Approvisionnement
          </Link>
          <ExportExcelButton
            disabled={loading}
            className="btn btn-ghost achats-header-btn"
            onExport={() => {
              downloadExcel(excelFilename("achats-libres", todayIsoDate()), [
                { name: "Achats", rows: movementRows(sorted) },
              ]);
              return Promise.resolve();
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={focusNewPurchase}
          >
            + Nouvel achat
          </button>
        </>
      }
    >
      <div className="catalogue-view achats-page">
        <p className="achats-pill" role="status">
          <span className="achats-pill-icon" aria-hidden>
            ⌕
          </span>
          Achats libres — registre hors catalogue
        </p>

        {error ? (
          <div className="catalogue-alert catalogue-alert-danger" role="alert">
            <span className="catalogue-alert-icon" aria-hidden>
              !
            </span>
            <span>
              {error}
              <button
                type="button"
                className="btn btn-ghost btn-sm catalogue-retry"
                onClick={() => reload()}
              >
                Réessayer
              </button>
            </span>
          </div>
        ) : null}

        {flash ? (
          <div className="catalogue-info achats-flash" role="status">
            <span className="catalogue-info-mark" aria-hidden>
              ✓
            </span>
            <p>{flash}</p>
          </div>
        ) : null}

        <div className="achats-warn-banner" role="note">
          <span className="achats-warn-icon" aria-hidden>
            ⚠
          </span>
          <p>
            Pour un équipement durable (frigo, table…) ou un emballage revendu
            en caisse, utilisez plutôt{" "}
            <Link href="/immobilisations">Immobilisations</Link> — chaque écran
            crée sa propre dépense de caisse, ne saisissez pas le même achat
            aux deux endroits.
          </p>
        </div>

        <div className="achats-kpi-grid" aria-label="Totaux achats">
          <div className="achats-kpi achats-kpi-gold">
            <span className="achats-kpi-ico" aria-hidden>
              ₣
            </span>
            <div>
              <span className="catalogue-kpi-label">Total des achats</span>
              <strong className="catalogue-kpi-value">
                {loading ? "…" : formatFcfa(totalMontant)}
              </strong>
              <span className="achats-kpi-hint">
                Cumul des achats libres actifs
              </span>
            </div>
          </div>
          <div className="achats-kpi achats-kpi-blue">
            <span className="achats-kpi-ico" aria-hidden>
              ≡
            </span>
            <div>
              <span className="catalogue-kpi-label">Achats enregistrés</span>
              <strong className="catalogue-kpi-value">
                {loading ? "…" : totalCount}
              </strong>
              <span className="achats-kpi-hint">
                Hors lignes annulées
              </span>
            </div>
          </div>
        </div>

        <section className="catalogue-panel" ref={formRef} id="nouvel-achat">
          <div className="catalogue-toolbar">
            <h2 className="panel-title" style={{ margin: 0 }}>
              Nouvel achat libre
            </h2>
          </div>
          <div
            className={`achats-form-grid${fournisseurs.length > 0 ? " has-fournisseur" : ""}`}
          >
            <label className="achats-field">
              <span className="achats-field-label">Date</span>
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
            </label>
            <label className="achats-field">
              <span className="achats-field-label">Produit</span>
              <input
                ref={productInputRef}
                type="text"
                className="input-text"
                placeholder="Nom du produit…"
                value={draftLibre.name}
                onChange={(e) =>
                  setDraftLibre((d) => ({ ...d, name: e.target.value }))
                }
                aria-label="Nom du produit acheté"
              />
            </label>
            <label className="achats-field">
              <span className="achats-field-label">Quantité</span>
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
            </label>
            <label className="achats-field">
              <span className="achats-field-label">Prix unitaire</span>
              <div className="achats-price-wrap">
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
                <span className="achats-price-suffix">FCFA</span>
              </div>
            </label>
            {fournisseurs.length > 0 ? (
              <label className="achats-field">
                <span className="achats-field-label">Fournisseur</span>
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
              </label>
            ) : null}
            <button
              type="button"
              className="btn btn-primary achats-form-submit"
              disabled={busyLibre}
              onClick={() => void submitPurchaseLibre(draftLibre)}
            >
              {busyLibre ? "…" : "+ Ajouter"}
            </button>
          </div>
          <div className="achats-form-hint">
            <span className="catalogue-info-mark" aria-hidden>
              i
            </span>
            <p>
              Pour un produit qui n&apos;est pas une matière de stock : la date
              réelle de l&apos;achat, le nom, la quantité et le prix.
              L&apos;achat n&apos;est ni modifiable ni annulable une fois
              enregistré.
            </p>
          </div>
        </section>

        {loading ? (
          <CatalogueSkeleton />
        ) : (
          <section className="catalogue-panel">
            <div className="catalogue-toolbar achats-list-toolbar">
              <div className="catalogue-search-wrap">
                <span className="catalogue-search-icon" aria-hidden>
                  ⌕
                </span>
                <input
                  type="search"
                  className="catalogue-search"
                  placeholder="Rechercher un achat…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Rechercher un achat"
                />
              </div>
              <div className="achats-filters">
                <button
                  type="button"
                  className={`catalogue-filter-btn${filtersOpen || statutFilter !== "all" ? " is-active" : ""}`}
                  aria-expanded={filtersOpen}
                  onClick={() => setFiltersOpen((v) => !v)}
                >
                  Filtres
                  {statutFilter !== "all" ? " · 1" : ""}
                </button>
                {filtersOpen ? (
                  <div className="achats-filters-panel" role="group" aria-label="Filtres statut">
                    {(
                      [
                        ["all", "Tous"],
                        ["valide", "Validé"],
                        ["corrige", "Corrigé"],
                        ["annule", "Annulé"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={`achats-filter-chip${statutFilter === key ? " is-active" : ""}`}
                        onClick={() => setStatutFilter(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="catalogue-empty">
                <p className="catalogue-empty-title">
                  {sorted.length === 0
                    ? "Aucun achat enregistré"
                    : "Aucun achat trouvé"}
                </p>
                <p className="catalogue-empty-hint">
                  {sorted.length === 0
                    ? "Aucun achat libre ne correspond actuellement."
                    : "Modifiez votre recherche ou vos filtres."}
                </p>
                {sorted.length === 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={focusNewPurchase}
                  >
                    + Nouvel achat
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="catalogue-table-wrap stock-zogbo-desktop-table">
                  <table className="catalogue-table">
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Désignation</th>
                        <th scope="col">Fournisseur</th>
                        <th scope="col">Qté</th>
                        <th scope="col">Prix unitaire</th>
                        <th scope="col">Montant</th>
                        <th scope="col">Statut</th>
                        <th scope="col" className="col-actions">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.items.map(({ date: d, movement: m }) => {
                        const open = detailId === m.id;
                        return (
                          <tr
                            key={m.id}
                            className={
                              m.cancelledAt
                                ? "row-warn"
                                : open
                                  ? "is-expanded"
                                  : undefined
                            }
                          >
                            <td>{formatDateFr(d)}</td>
                            <td>
                              <span className="catalogue-product-name achats-name">
                                {m.name}
                              </span>
                            </td>
                            <td>{m.fournisseurNom || "—"}</td>
                            <td>
                              <span className="catalogue-qty-badge">
                                {m.qty}
                              </span>
                            </td>
                            <td>
                              <span className="catalogue-price-badge catalogue-price-badge-sale">
                                {formatFcfa(m.unitPrice)}
                              </span>
                            </td>
                            <td>
                              <span className="catalogue-price-badge catalogue-price-badge-cost">
                                {formatFcfa(m.qty * m.unitPrice)}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`achats-status${
                                  m.cancelledAt
                                    ? " achats-status-warn"
                                    : m.editedAt
                                      ? " achats-status-muted"
                                      : " achats-status-ok"
                                }`}
                              >
                                {statutLabel(m)}
                              </span>
                            </td>
                            <td className="col-actions">
                              <button
                                type="button"
                                className={`catalogue-action-btn${open ? " is-active" : ""}`}
                                aria-label={
                                  open
                                    ? `Masquer le détail de ${m.name}`
                                    : `Voir le détail de ${m.name}`
                                }
                                aria-expanded={open}
                                onClick={() =>
                                  setDetailId(open ? null : m.id)
                                }
                              >
                                {open ? "−" : "i"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {detailId ? (
                  <div className="achats-detail stock-zogbo-desktop-table">
                    {(() => {
                      const row = paged.items.find(
                        (e) => e.movement.id === detailId,
                      );
                      if (!row) return null;
                      const m = row.movement;
                      return (
                        <p>
                          <strong>{m.name}</strong>
                          {" · "}
                          {formatDateFr(row.date)}
                          {" · "}
                          {m.qty} × {formatFcfa(m.unitPrice)} ={" "}
                          {formatFcfa(m.qty * m.unitPrice)}
                          {m.fournisseurNom
                            ? ` · Fournisseur : ${m.fournisseurNom}`
                            : ""}
                          {m.depenseId ? " · Dépense de caisse liée" : ""}
                          {" · Lecture seule (non modifiable)"}
                        </p>
                      );
                    })()}
                  </div>
                ) : null}

                <div className="stock-zogbo-mobile-list">
                  {paged.items.map(({ date: d, movement: m }) => {
                    const open = detailId === m.id;
                    return (
                      <article
                        key={m.id}
                        className={`stock-mobile-card${m.cancelledAt ? " is-warn" : ""}`}
                      >
                        <div className="stock-mobile-card-head">
                          <span className="catalogue-product-name">
                            {m.name}
                          </span>
                          <span
                            className={`achats-status${
                              m.cancelledAt
                                ? " achats-status-warn"
                                : " achats-status-ok"
                            }`}
                          >
                            {statutLabel(m)}
                          </span>
                        </div>
                        <div className="catalogue-mobile-card-prices">
                          <div>
                            <span className="catalogue-mobile-price-label">
                              Date
                            </span>
                            <strong>{formatDateFr(d)}</strong>
                          </div>
                          <div>
                            <span className="catalogue-mobile-price-label">
                              Quantité
                            </span>
                            <strong>{m.qty}</strong>
                          </div>
                          <div>
                            <span className="catalogue-mobile-price-label">
                              Prix unitaire
                            </span>
                            <strong>{formatFcfa(m.unitPrice)}</strong>
                          </div>
                          <div>
                            <span className="catalogue-mobile-price-label">
                              Montant
                            </span>
                            <strong>
                              {formatFcfa(m.qty * m.unitPrice)}
                            </strong>
                          </div>
                        </div>
                        <p className="catalogue-meta" style={{ margin: 0 }}>
                          {m.fournisseurNom
                            ? `Fournisseur : ${m.fournisseurNom}`
                            : "Sans fournisseur"}
                          {m.depenseId ? " · dépense liée" : ""}
                        </p>
                        <div className="catalogue-mobile-card-actions">
                          <button
                            type="button"
                            className={`catalogue-action-btn${open ? " is-active" : ""}`}
                            onClick={() =>
                              setDetailId(open ? null : m.id)
                            }
                          >
                            Voir
                          </button>
                        </div>
                        {open ? (
                          <p className="achats-detail-inline">
                            Lecture seule — non modifiable ni annulable
                            {m.depenseId ? " · dépense de caisse liée" : ""}
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>

                <CataloguePaginationBar
                  from={paged.from}
                  to={paged.to}
                  total={paged.total}
                  page={paged.page}
                  totalPages={paged.totalPages}
                  onPage={setPage}
                  itemLabel="achat"
                />
              </>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
