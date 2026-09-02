"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
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
      subtitle="Hors catalogue uniquement. Les matières du catalogue se saisissent dans Approvisionnement."
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
            onClick={focusNewPurchase}
          >
            + Nouvel achat
          </button>
        </>
      }
    >
      <div className="achats-page">
        <header className="achats-hero">
          <div className="achats-hero-main">
            <p className="achats-hero-note">
              Achats libres — produits hors catalogue. Les sorties de caisse
              liées restent visibles dans Caisse.
            </p>
            <p className="achats-hero-note is-warn">
              Pour un équipement durable ou un emballage revendu en caisse,
              utilisez plutôt{" "}
              <Link href="/immobilisations">Immobilisations</Link> — ne
              saisissez pas le même achat aux deux endroits.
            </p>
          </div>
          <div className="achats-kpis" aria-label="Totaux achats">
            <div className="achats-kpi is-gold">
              <span>Total actif</span>
              <strong>{loading ? "…" : formatFcfa(totalMontant)}</strong>
            </div>
            <div className="achats-kpi is-blue">
              <span>Enregistrements</span>
              <strong>{loading ? "…" : totalCount}</strong>
            </div>
          </div>
        </header>

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

        <div className="achats-layout">
          <section
            className="achats-declare"
            ref={formRef}
            id="nouvel-achat"
            aria-label="Nouvel achat libre"
          >
            <h2>Nouvel achat libre</h2>
            <div className="achats-form">
              <label className="achats-field">
                <span>Date</span>
                <input
                  type="date"
                  value={draftLibre.date}
                  max={todayIsoDate()}
                  onChange={(e) =>
                    setDraftLibre((d) => ({ ...d, date: e.target.value }))
                  }
                  aria-label="Date de l'achat"
                />
              </label>
              <label className="achats-field">
                <span>Produit</span>
                <input
                  ref={productInputRef}
                  type="text"
                  placeholder="Nom du produit…"
                  value={draftLibre.name}
                  onChange={(e) =>
                    setDraftLibre((d) => ({ ...d, name: e.target.value }))
                  }
                  aria-label="Nom du produit acheté"
                />
              </label>
              <label className="achats-field">
                <span>Quantité</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="Qté"
                  value={draftLibre.qty}
                  onChange={(e) =>
                    setDraftLibre((d) => ({ ...d, qty: e.target.value }))
                  }
                  aria-label="Quantité achetée"
                />
              </label>
              <label className="achats-field">
                <span>Prix unitaire</span>
                <div className="achats-price-wrap">
                  <input
                    type="number"
                    min={0}
                    step="any"
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
                  <span>Fournisseur</span>
                  <select
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
                className="btn btn-primary achats-submit"
                disabled={busyLibre}
                onClick={() => void submitPurchaseLibre(draftLibre)}
              >
                {busyLibre ? "…" : "+ Enregistrer"}
              </button>
            </div>
            <p className="achats-form-hint">
              Date réelle, nom, quantité et prix. Une fois enregistré, l&apos;achat
              n&apos;est ni modifiable ni annulable.
            </p>
          </section>

          <section className="achats-board" aria-label="Registre des achats">
            <div className="achats-board-head">
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
              </div>
            </div>

            {loading ? (
              <p className="muted">Chargement…</p>
            ) : filtered.length === 0 ? (
              <div className="achats-empty">
                <strong>
                  {sorted.length === 0
                    ? "Aucun achat enregistré"
                    : "Aucun achat trouvé"}
                </strong>
                <span>
                  {sorted.length === 0
                    ? "Saisissez un premier achat libre à gauche."
                    : "Modifiez votre recherche ou vos filtres."}
                </span>
                {sorted.length === 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: "0.85rem" }}
                    onClick={focusNewPurchase}
                  >
                    + Nouvel achat
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <ul className="achats-list">
                  {paged.items.map(({ date: d, movement: m }) => {
                    const open = detailId === m.id;
                    return (
                      <li
                        key={m.id}
                        className={`achats-row${m.cancelledAt ? " is-warn" : ""}${open ? " is-open" : ""}`}
                      >
                        <div className="achats-row-top">
                          <div className="achats-row-main">
                            <span className="achats-row-name">{m.name}</span>
                            <p className="achats-row-meta">
                              {formatDateFr(d)}
                              {m.fournisseurNom
                                ? ` · ${m.fournisseurNom}`
                                : " · Sans fournisseur"}
                              {" · "}
                              {m.qty} × {formatFcfa(m.unitPrice)}
                            </p>
                          </div>
                          <div className="achats-row-side">
                            <span className="achats-row-amount">
                              {formatFcfa(m.qty * m.unitPrice)}
                            </span>
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
                          </div>
                        </div>
                        <div className="achats-row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-expanded={open}
                            onClick={() => setDetailId(open ? null : m.id)}
                          >
                            {open ? "Masquer" : "Détail"}
                          </button>
                        </div>
                        {open ? (
                          <p className="achats-row-detail">
                            {m.qty} × {formatFcfa(m.unitPrice)} ={" "}
                            {formatFcfa(m.qty * m.unitPrice)}
                            {m.depenseId ? " · Dépense de caisse liée" : ""}
                            {" · Lecture seule (non modifiable)"}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>

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
      </div>
    </AppShell>
  );
}
