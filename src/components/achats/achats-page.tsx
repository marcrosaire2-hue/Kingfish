"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ExportExcelButton } from "@/components/export-excel-button";
import { CataloguePaginationBar } from "@/components/parametres/catalogue-view";
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
import "./achats-page.css";

/** Achats libres : tout ce qui n'est pas une matière du catalogue. */
function isLibre(m: MatieresMovement): boolean {
  return m.type === "autre";
}

const RANGE_FROM = "2020-01-01";
const PAGE_SIZE = 12;

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

function lineTotal(qty: string, price: string): number {
  const q = Number(String(qty).replace(",", ".")) || 0;
  const p = Number(String(price).replace(",", ".")) || 0;
  return q > 0 && p > 0 ? q * p : 0;
}

export function AchatsPage() {
  const composerRef = useRef<HTMLElement | null>(null);
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

  function focusComposer() {
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => productInputRef.current?.focus(), 220);
  }

  async function submitPurchaseLibre(e?: FormEvent) {
    e?.preventDefault();
    const row = draftLibre;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
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
  const lastDate = sorted[0]?.date ?? null;
  const draftTotal = lineTotal(draftLibre.qty, draftLibre.price);
  const counts = useMemo(() => {
    let valide = 0;
    let corrige = 0;
    let annule = 0;
    for (const { movement: m } of entries) {
      const k = statutKey(m);
      if (k === "valide") valide += 1;
      else if (k === "corrige") corrige += 1;
      else annule += 1;
    }
    return { valide, corrige, annule, all: entries.length };
  }, [entries]);

  return (
    <AppShell
      title="Achats"
      subtitle="Hors catalogue — les matières se saisissent dans Approvisionnement."
      mainClassName="main-achats"
      actions={
        <>
          <Link href="/appro" className="btn btn-ghost">
            Approvisionnement
          </Link>
          <ExportExcelButton
            disabled={loading}
            className="btn btn-ghost"
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
            onClick={focusComposer}
          >
            + Nouvel achat
          </button>
        </>
      }
    >
      <div className="achats-page">
        <div className="achats-stats" aria-label="Totaux achats">
          <article className="achats-stat is-gold">
            <span>Total actif</span>
            <strong>{loading ? "…" : formatFcfa(totalMontant)}</strong>
          </article>
          <article className="achats-stat is-blue">
            <span>Lignes</span>
            <strong>{loading ? "…" : totalCount}</strong>
          </article>
          <article className="achats-stat">
            <span>Dernier achat</span>
            <strong>{loading ? "…" : lastDate ? formatDateFr(lastDate) : "—"}</strong>
          </article>
        </div>

        {error ? (
          <p className="error-banner" role="alert">
            {error}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => reload()}
            >
              Réessayer
            </button>
          </p>
        ) : null}

        {flash ? (
          <p className="achats-flash" role="status">
            {flash}
          </p>
        ) : null}

        <section
          ref={composerRef}
          className="achats-composer"
          id="nouvel-achat"
          aria-label="Saisie d’un achat libre"
        >
          <header className="achats-composer-head">
            <h2>Saisie rapide</h2>
            <p>
              Une fois enregistré, l’achat n’est ni modifiable ni annulable.{" "}
              <Link href="/immobilisations">Immobilisations</Link> pour un
              équipement durable.
            </p>
          </header>
          <form className="achats-composer-grid" onSubmit={submitPurchaseLibre}>
            <label className="achats-field">
              <span>Date</span>
              <input
                type="date"
                value={draftLibre.date}
                max={todayIsoDate()}
                onChange={(e) =>
                  setDraftLibre((d) => ({ ...d, date: e.target.value }))
                }
                required
              />
            </label>
            <label className="achats-field achats-field-grow">
              <span>Produit</span>
              <input
                ref={productInputRef}
                type="text"
                placeholder="Nom du produit…"
                value={draftLibre.name}
                onChange={(e) =>
                  setDraftLibre((d) => ({ ...d, name: e.target.value }))
                }
                autoComplete="off"
                required
              />
            </label>
            <label className="achats-field">
              <span>Qté</span>
              <input
                type="number"
                min={0}
                step="any"
                placeholder="0"
                value={draftLibre.qty}
                onChange={(e) =>
                  setDraftLibre((d) => ({ ...d, qty: e.target.value }))
                }
                required
              />
            </label>
            <label className="achats-field">
              <span>Prix / u</span>
              <div className="achats-price-wrap">
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="0"
                  value={draftLibre.price}
                  onChange={(e) =>
                    setDraftLibre((d) => ({ ...d, price: e.target.value }))
                  }
                  required
                />
                <span className="achats-price-suffix">F</span>
              </div>
            </label>
            {fournisseurs.length > 0 ? (
              <label className="achats-field achats-field-grow">
                <span>Fournisseur</span>
                <select
                  value={draftLibre.fournisseurId}
                  onChange={(e) =>
                    setDraftLibre((d) => ({
                      ...d,
                      fournisseurId: e.target.value,
                    }))
                  }
                >
                  <option value="">Sans fournisseur</option>
                  {fournisseurs.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nom}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="achats-composer-total">
              <span>Montant</span>
              <strong>{draftTotal > 0 ? formatFcfa(draftTotal) : "—"}</strong>
            </div>
            <button
              type="submit"
              className="btn btn-primary achats-submit"
              disabled={busyLibre}
            >
              {busyLibre ? "…" : "Enregistrer"}
            </button>
          </form>
        </section>

        <section className="achats-ledger" aria-label="Registre des achats">
          <div className="achats-ledger-head">
            <h2>Registre</h2>
            <div className="achats-toolbar">
              <input
                type="search"
                className="achats-search"
                placeholder="Rechercher un achat…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Rechercher un achat"
              />
              <div
                className="achats-status-filters"
                role="group"
                aria-label="Filtre statut"
              >
                {(
                  [
                    ["all", "Tous", counts.all],
                    ["valide", "Validé", counts.valide],
                    ["corrige", "Corrigé", counts.corrige],
                    ["annule", "Annulé", counts.annule],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    className={`achats-filter-chip${statutFilter === key ? " is-active" : ""}`}
                    onClick={() => setStatutFilter(key)}
                  >
                    {label}
                    <i>{count}</i>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <BrandLoader label="Chargement des achats…" variant="ligne" />
          ) : filtered.length === 0 ? (
            <div className="achats-empty">
              <strong>
                {sorted.length === 0
                  ? "Aucun achat enregistré"
                  : "Aucun achat trouvé"}
              </strong>
              <span>
                {sorted.length === 0
                  ? "Saisissez la première ligne dans la barre du haut."
                  : "Modifiez votre recherche ou vos filtres."}
              </span>
              {sorted.length === 0 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={focusComposer}
                >
                  + Nouvel achat
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="table-scroll">
                <table className="data-table achats-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Produit</th>
                      <th>Fournisseur</th>
                      <th className="num">Qté</th>
                      <th className="num">Prix / u</th>
                      <th className="num">Montant</th>
                      <th>Statut</th>
                      <th className="achats-col-action">
                        <span className="sr-only">Détail</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.items.map(({ date: d, movement: m }) => {
                      const open = detailId === m.id;
                      const montant = m.qty * m.unitPrice;
                      return (
                        <tr
                          key={m.id}
                          className={`${m.cancelledAt ? "is-cancelled" : ""}${open ? " is-open" : ""}`}
                        >
                          <td className="achats-td-date">{formatDateFr(d)}</td>
                          <td>
                            <strong className="achats-td-name">{m.name}</strong>
                            {open ? (
                              <p className="achats-td-detail">
                                {m.qty} × {formatFcfa(m.unitPrice)} ={" "}
                                {formatFcfa(montant)}
                                {m.depenseId
                                  ? " · Dépense de caisse liée"
                                  : " · Pas de dépense liée"}
                                {" · Lecture seule"}
                              </p>
                            ) : null}
                          </td>
                          <td>{m.fournisseurNom || "—"}</td>
                          <td className="num mono">{m.qty}</td>
                          <td className="num mono">{formatFcfa(m.unitPrice)}</td>
                          <td className="num mono achats-td-amount">
                            {formatFcfa(montant)}
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
                          <td className="achats-col-action">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-expanded={open}
                              onClick={() => setDetailId(open ? null : m.id)}
                            >
                              {open ? "Masquer" : "Détail"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
      </div>
    </AppShell>
  );
}
