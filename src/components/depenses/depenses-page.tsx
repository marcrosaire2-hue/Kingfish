"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { CataloguePaginationBar } from "@/components/parametres/catalogue-view";
import { useSession } from "@/components/session-provider";
import { formatDateFr } from "@/components/achats/achats-shared";
import {
  CAISSE_LABELS,
  CAISSE_SHORT_LABELS,
} from "@/lib/caisse-model";
import { formatFcfa } from "@/lib/format";
import type { CaisseKey, CaisseMouvement } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import "@/components/achats/achats-page.css";

type DepenseRow = {
  sessionId: string;
  sessionDate: string;
  sessionUserName: string | null;
  mouvement: CaisseMouvement;
};

const PAGE_SIZE = 12;

type StatutFilter = "all" | "valide" | "annule";

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

function statutLabel(m: CaisseMouvement): string {
  return m.cancelledAt ? "Annulé" : "Validé";
}

function statutKey(m: CaisseMouvement): Exclude<StatutFilter, "all"> {
  return m.cancelledAt ? "annule" : "valide";
}

export function DepensesPage() {
  const { user, ready } = useSession();
  const composerRef = useRef<HTMLElement | null>(null);
  const motifInputRef = useRef<HTMLInputElement | null>(null);

  const [rows, setRows] = useState<DepenseRow[]>([]);
  const [caisse, setCaisse] = useState<CaisseKey | "">("");
  const [allowed, setAllowed] = useState<CaisseKey[]>([]);
  const [caisseOpen, setCaisseOpen] = useState(false);
  const [activeDate, setActiveDate] = useState<string | null>(null);

  const [draftDate, setDraftDate] = useState(() => todayIsoDate());
  const [nature, setNature] = useState("");
  const [beneficiaire, setBeneficiaire] = useState("");
  const [montant, setMontant] = useState("");

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statutFilter, setStatutFilter] = useState<StatutFilter>("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  function reload(nextCaisse?: CaisseKey | "") {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          from: "2020-01-01",
          to: todayIsoDate(),
        });
        const c = nextCaisse || caisse;
        if (c) qs.set("caisse", c);
        const res = await fetch(`/api/achats?${qs}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Impossible de charger les dépenses.");
        setRows(body.depenses ?? []);
        if (body.caisse) setCaisse(body.caisse as CaisseKey);
        setAllowed((body.allowedCaisses as CaisseKey[]) ?? []);
        setCaisseOpen(Boolean(body.caisseOpen));
        setActiveDate(body.activeDate ?? null);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Impossible de charger les dépenses.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }

  useEffect(() => {
    if (!ready) return;
    if (user?.role === "admin") {
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.role]);

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) =>
        b.mouvement.at.localeCompare(a.mouvement.at),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = normalizeSearch(debouncedSearch);
    return sorted.filter((row) => {
      const m = row.mouvement;
      if (statutFilter !== "all" && statutKey(m) !== statutFilter) return false;
      if (!q) return true;
      const blob = [
        m.nature,
        m.beneficiaire,
        m.actorName ?? "",
        row.sessionDate,
        statutLabel(m),
      ].join(" ");
      return normalizeSearch(blob).includes(q);
    });
  }, [sorted, debouncedSearch, statutFilter]);

  const paged = useMemo(
    () => paginate(filtered, page, PAGE_SIZE),
    [filtered, page],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statutFilter, caisse]);

  const totalMontant = useMemo(
    () =>
      sorted
        .filter((r) => !r.mouvement.cancelledAt)
        .reduce((s, r) => s + r.mouvement.montant, 0),
    [sorted],
  );
  const totalCount = sorted.filter((r) => !r.mouvement.cancelledAt).length;
  const lastDate = sorted[0]?.sessionDate ?? null;

  const counts = useMemo(() => {
    let valide = 0;
    let annule = 0;
    for (const r of sorted) {
      if (r.mouvement.cancelledAt) annule += 1;
      else valide += 1;
    }
    return { valide, annule, all: sorted.length };
  }, [sorted]);

  function focusComposer() {
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => motifInputRef.current?.focus(), 220);
  }

  async function submitDepense(e?: FormEvent) {
    e?.preventDefault();
    if (!caisse) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/achats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "depense",
          caisse,
          date: draftDate,
          nature,
          beneficiaire,
          montant: Number(montant) || 0,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Échec enregistrement");
      setFlash(`Dépense enregistrée · ${formatFcfa(Number(montant) || 0)}`);
      setNature("");
      setBeneficiaire("");
      setMontant("");
      reload(caisse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  if (ready && user?.role === "admin") {
    return (
      <AppShell title="Dépenses" subtitle="Accès restreint">
        <p className="error-banner" role="alert">
          Les dépenses sont saisies par les équipes de site. L&apos;admin gère
          le capital sur{" "}
          <Link href="/mouvements-caisse">Mouvements de fonds</Link>.
        </p>
      </AppShell>
    );
  }

  const resolved = (caisse || allowed[0] || "zogbo") as CaisseKey;
  const canSubmit =
    caisseOpen &&
    !(activeDate != null && draftDate !== activeDate && draftDate >= todayIsoDate());

  return (
    <AppShell
      title="Dépenses"
      subtitle="Sorties de caisse — déduites du solde automatiquement."
      mainClassName="main-achats"
      actions={
        <>
          <Link href="/caisse" className="btn btn-ghost">
            Caisse
          </Link>
          {allowed.length > 1 ? (
            <div className="site-switch" role="tablist" aria-label="Site">
              {allowed.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={resolved === c}
                  className={`site-btn${resolved === c ? " is-active" : ""}`}
                  onClick={() => {
                    setCaisse(c);
                    reload(c);
                  }}
                >
                  {CAISSE_SHORT_LABELS[c]}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            onClick={focusComposer}
          >
            + Nouvelle dépense
          </button>
        </>
      }
    >
      <div className="achats-page">
        <div className="achats-stats" aria-label="Totaux dépenses">
          <article className="achats-stat is-gold">
            <span>Total actif</span>
            <strong>{loading ? "…" : formatFcfa(totalMontant)}</strong>
          </article>
          <article className="achats-stat is-blue">
            <span>Lignes</span>
            <strong>{loading ? "…" : totalCount}</strong>
          </article>
          <article className="achats-stat">
            <span>Dernière dépense</span>
            <strong>
              {loading ? "…" : lastDate ? formatDateFr(lastDate) : "—"}
            </strong>
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
          id="nouvelle-depense"
          aria-label="Saisie d’une dépense"
        >
          <header className="achats-composer-head">
            <h2>Saisie rapide</h2>
            <p>
              La dépense sort de la {CAISSE_LABELS[resolved].toLowerCase()}.{" "}
              {!caisseOpen
                ? "Ouvrez la caisse avant d’enregistrer."
                : activeDate
                  ? `Session ouverte au ${formatDateFr(activeDate)}.`
                  : null}
            </p>
          </header>
          <form
            className="achats-composer-grid"
            onSubmit={(e) => void submitDepense(e)}
          >
            <label className="achats-field">
              <span>Date</span>
              <input
                type="date"
                value={draftDate}
                max={todayIsoDate()}
                onChange={(e) => setDraftDate(e.target.value)}
                required
              />
            </label>
            <label className="achats-field achats-field-grow">
              <span>Motif</span>
              <input
                ref={motifInputRef}
                type="text"
                placeholder="Ex. course marché, transport…"
                value={nature}
                onChange={(e) => setNature(e.target.value)}
                autoComplete="off"
                required
                minLength={2}
              />
            </label>
            <label className="achats-field achats-field-grow">
              <span>Bénéficiaire</span>
              <input
                type="text"
                placeholder="Optionnel"
                value={beneficiaire}
                onChange={(e) => setBeneficiaire(e.target.value)}
              />
            </label>
            <label className="achats-field">
              <span>Montant</span>
              <div className="achats-price-wrap">
                <input
                  type="number"
                  min={1}
                  step="1"
                  placeholder="0"
                  value={montant}
                  onChange={(e) => setMontant(e.target.value)}
                  required
                />
                <span className="achats-price-suffix">F</span>
              </div>
            </label>
            <div className="achats-composer-total">
              <span>Montant</span>
              <strong>
                {Number(montant) > 0 ? formatFcfa(Number(montant) || 0) : "—"}
              </strong>
            </div>
            <button
              type="submit"
              className="btn btn-primary achats-submit"
              disabled={busy || !nature.trim() || !montant || !canSubmit}
            >
              {busy ? "…" : "Enregistrer"}
            </button>
          </form>
        </section>

        <section className="achats-ledger" aria-label="Registre des dépenses">
          <div className="achats-ledger-head">
            <h2>Registre</h2>
            <div className="achats-toolbar">
              <input
                type="search"
                className="achats-search"
                placeholder="Rechercher une dépense…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Rechercher une dépense"
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
            <BrandLoader label="Chargement des dépenses…" />
          ) : filtered.length === 0 ? (
            <div className="achats-empty">
              <strong>
                {sorted.length === 0
                  ? "Aucune dépense enregistrée"
                  : "Aucune dépense trouvée"}
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
                  + Nouvelle dépense
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
                      <th>Motif</th>
                      <th>Bénéficiaire</th>
                      <th className="num">Montant</th>
                      <th>Par</th>
                      <th>Statut</th>
                      <th className="achats-col-action">
                        <span className="sr-only">Détail</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.items.map((row) => {
                      const m = row.mouvement;
                      const open = detailId === m.id;
                      return (
                        <tr
                          key={m.id}
                          className={`${m.cancelledAt ? "is-cancelled" : ""}${open ? " is-open" : ""}`}
                        >
                          <td className="achats-td-date">
                            {formatDateFr(row.sessionDate)}
                          </td>
                          <td>
                            <strong className="achats-td-name">
                              {m.nature}
                            </strong>
                            {open ? (
                              <p className="achats-td-detail">
                                {formatFcfa(m.montant)}
                                {m.soldeAvant != null && m.soldeApres != null
                                  ? ` · solde ${formatFcfa(m.soldeAvant)} → ${formatFcfa(m.soldeApres)}`
                                  : ""}
                                {m.cancelledAt
                                  ? ` · Annulé${m.cancelledByName ? ` par ${m.cancelledByName}` : ""}`
                                  : " · Sortie de caisse"}
                              </p>
                            ) : null}
                          </td>
                          <td>
                            {m.beneficiaire && m.beneficiaire !== "—"
                              ? m.beneficiaire
                              : "—"}
                          </td>
                          <td className="num mono achats-td-amount">
                            {formatFcfa(m.montant)}
                          </td>
                          <td>{m.actorName ?? row.sessionUserName ?? "—"}</td>
                          <td>
                            <span
                              className={`achats-status${
                                m.cancelledAt
                                  ? " achats-status-warn"
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
                              onClick={() =>
                                setDetailId(open ? null : m.id)
                              }
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
                itemLabel="dépense"
              />
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}
