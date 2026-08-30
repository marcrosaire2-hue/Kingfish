"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import {
  CataloguePaginationBar,
  CatalogueSkeleton,
} from "@/components/parametres/catalogue-view";
import "@/components/parametres/parametres-catalogue.css";
import { formatFcfa } from "@/lib/format";
import { computeMatieresDay } from "@/lib/matieres-calc";
import { exportPertesExcel } from "@/lib/page-exports";
import { PERTE_MOTIF_LABELS } from "@/lib/types";
import type {
  Immobilisation,
  MatieresDay,
  MatieresMovement,
  PerteEntry,
  PerteKind,
  PerteMotif,
  RawMaterial,
  VenteProduct,
  VenteSite,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

type Famille = { key: PerteKind; label: string };

const FAMILLES: Famille[] = [
  { key: "plat", label: "Plats" },
  { key: "local", label: "Sur place" },
  { key: "boisson", label: "Boissons" },
  { key: "matiere", label: "Matières" },
  { key: "immobilisation", label: "Emballages / Actifs" },
  { key: "libre", label: "Achats hors-catalogue" },
];

const MOTIFS = Object.entries(PERTE_MOTIF_LABELS) as [PerteMotif, string][];

const RANGE_FROM = "2020-01-01";
const PAGE_SIZE = 10;

type Candidat = {
  productId: string;
  name: string;
  stock: number | null;
  sourceDate?: string;
};

type StatutFilter = "all" | "actif" | "annule";

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

function formatHeure(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeStyle: "short",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function familleLabel(kind: PerteKind): string {
  return FAMILLES.find((f) => f.key === kind)?.label ?? kind;
}

export function PertesPage() {
  const formRef = useRef<HTMLElement | null>(null);

  const [date, setDate] = useState(() => todayIsoDate());
  const [site, setSite] = useState<VenteSite>("gbegamey");
  const [userSite, setUserSite] = useState<VenteSite | "tous" | null>(null);
  const [famille, setFamille] = useState<PerteKind>("plat");

  const [produits, setProduits] = useState<VenteProduct[]>([]);
  const [matieres, setMatieres] = useState<Candidat[]>([]);
  const [immobilisations, setImmobilisations] = useState<Candidat[]>([]);
  const [achatsLibres, setAchatsLibres] = useState<Candidat[]>([]);
  const [pertes, setPertes] = useState<PerteEntry[]>([]);

  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [motif, setMotif] = useState<PerteMotif>("gate");
  const [commentaire, setCommentaire] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statutFilter, setStatutFilter] = useState<StatutFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(search);

  const chargerJournal = useCallback(async (jour: string) => {
    const res = await fetch(`/api/pertes?date=${encodeURIComponent(jour)}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const body = (await res.json()) as {
      pertes: PerteEntry[];
      site?: VenteSite | "tous";
    };
    setPertes(body.pertes ?? []);
    setUserSite(body.site ?? "tous");
  }, []);

  const charger = useCallback(
    async (jour: string, point: VenteSite) => {
      setLoading(true);
      setError(null);
      try {
        const journalRes = await fetch(
          `/api/pertes?date=${encodeURIComponent(jour)}`,
          { cache: "no-store" },
        );
        if (journalRes.ok) {
          const journal = (await journalRes.json()) as {
            pertes: PerteEntry[];
            site?: VenteSite | "tous";
          };
          setPertes(journal.pertes ?? []);
          const scope = journal.site ?? "tous";
          setUserSite(scope);
          if (scope === "zogbo" || scope === "gbegamey") {
            setSite(scope);
          }
        }
        const effectivePoint: VenteSite =
          userSite === "zogbo" || userSite === "gbegamey"
            ? userSite
            : point;
        const [vente, mat, immo, achats] = await Promise.all([
          fetch(
            `/api/vente?date=${encodeURIComponent(jour)}&site=${effectivePoint}`,
            { cache: "no-store" },
          ),
          fetch(`/api/matieres?date=${encodeURIComponent(jour)}`, {
            cache: "no-store",
          }),
          fetch(
            `/api/immobilisations?active=1&site=${effectivePoint}`,
            { cache: "no-store" },
          ),
          fetch(
            `/api/matieres?from=${RANGE_FROM}&to=${encodeURIComponent(todayIsoDate())}`,
            { cache: "no-store" },
          ),
        ]);

        if (vente.ok) {
          const body = (await vente.json()) as { products: VenteProduct[] };
          setProduits(body.products ?? []);
        }
        if (mat.ok) {
          const body = (await mat.json()) as {
            day: MatieresDay;
            materials: RawMaterial[];
          };
          const calcule = computeMatieresDay(body.day, body.materials);
          setMatieres(
            calcule.lines.map((l) => ({
              productId: l.productId,
              name: l.name,
              stock: l.stock,
            })),
          );
        }
        if (immo.ok) {
          const body = (await immo.json()) as { items: Immobilisation[] };
          setImmobilisations(
            (body.items ?? []).map((it) => ({
              productId: it.id,
              name: it.name,
              stock: it.qty,
            })),
          );
        }
        if (achats.ok) {
          const body = (await achats.json()) as {
            historique?: Array<{ date: string; movement: MatieresMovement }>;
          };
          setAchatsLibres(
            (body.historique ?? [])
              .filter(
                ({ movement: m }) => m.type === "autre" && !m.cancelledAt,
              )
              .map(({ date: d, movement: m }) => ({
                productId: m.id,
                name: m.name,
                stock: Math.max(0, m.qty - (m.pertes ?? 0)),
                sourceDate: d,
              }))
              .filter((c) => c.stock > 0),
          );
        }
        await chargerJournal(jour);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur de chargement");
      } finally {
        setLoading(false);
      }
    },
    [chargerJournal, userSite],
  );

  useEffect(() => {
    void charger(date, site);
  }, [date, site, userSite, charger]);

  const candidats = useMemo<Candidat[]>(() => {
    if (famille === "matiere") return matieres;
    if (famille === "immobilisation") return immobilisations;
    if (famille === "libre") return achatsLibres;
    return produits
      .filter((p) => p.kind === famille)
      .map((p) => ({
        productId: p.productId,
        name: p.name,
        stock: p.stockLeft ?? null,
      }));
  }, [famille, produits, matieres, immobilisations, achatsLibres]);

  const choisi = candidats.find((c) => c.productId === productId) ?? null;
  const enBouteilles = famille === "boisson";

  const filtered = useMemo(() => {
    const q = normalizeSearch(debouncedSearch);
    return pertes.filter((p) => {
      if (statutFilter === "actif" && p.cancelledAt) return false;
      if (statutFilter === "annule" && !p.cancelledAt) return false;
      if (!q) return true;
      const blob = [
        p.name,
        PERTE_MOTIF_LABELS[p.motif],
        familleLabel(p.kind),
        p.commentaire,
        p.actorName ?? "",
      ].join(" ");
      return normalizeSearch(blob).includes(q);
    });
  }, [pertes, debouncedSearch, statutFilter]);

  const paged = useMemo(
    () => paginate(filtered, page, PAGE_SIZE),
    [filtered, page],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statutFilter, date]);

  async function declarer(e: React.FormEvent) {
    e.preventDefault();
    const quantite = Number(String(qty).replace(",", "."));
    if (!productId || !Number.isFinite(quantite) || quantite <= 0) {
      setError("Choisissez un produit et une quantité.");
      return;
    }
    if (famille === "libre" && !choisi?.sourceDate) {
      setError("Achat source introuvable — rechargez la page.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pertes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "declare",
          date,
          site,
          kind: famille,
          productId,
          qty: quantite,
          motif,
          commentaire,
          sourceDate: famille === "libre" ? choisi?.sourceDate : undefined,
        }),
      });
      const body = (await res.json()) as { entry?: PerteEntry; error?: string };
      if (!res.ok) throw new Error(body.error || "Déclaration impossible");
      setQty("");
      setCommentaire("");
      setFlash(
        `Perte enregistrée : ${body.entry?.qty} × ${body.entry?.name}`,
      );
      window.setTimeout(() => setFlash(null), 2500);
      await charger(date, site);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Déclaration impossible");
    } finally {
      setBusy(false);
    }
  }

  async function annuler(entry: PerteEntry) {
    if (
      !window.confirm(
        `Annuler cette perte ?\n\n${entry.qty} × ${entry.name}\nLe stock sera repris.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pertes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", id: entry.id }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Annulation impossible");
      await charger(date, site);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Annulation impossible");
    } finally {
      setBusy(false);
    }
  }

  const actives = pertes.filter((p) => !p.cancelledAt);
  const coutDuJour = actives.reduce((s, p) => s + p.cost, 0);

  return (
    <AppShell
      title="Pertes"
      subtitle="Perte constatée sur un plat, une matière, un emballage, un actif ou un achat — jamais une vente. Le motif est obligatoire."
      mainClassName="main-pertes"
      actions={
        <>
          {pertes.length > 0 ? (
            <ExportExcelButton
              label="Excel"
              className="btn btn-ghost achats-header-btn"
              onExport={() =>
                exportPertesExcel({ date, site: userSite ?? site, pertes })
              }
            />
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              formRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              })
            }
          >
            + Déclarer
          </button>
        </>
      }
    >
      <div className="catalogue-view">
        <p className="achats-pill" role="status">
          <span className="achats-pill-icon" aria-hidden>
            −
          </span>
          Journal des pertes — stock repris à l&apos;annulation
        </p>

        <div className="pertes-toolbar">
          <label className="achats-field">
            <span className="achats-field-label">Jour</span>
            <input
              type="date"
              className="input-text"
              value={date}
              max={todayIsoDate()}
              onChange={(e) => {
                const v = e.target.value;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                setDate(v);
              }}
            />
          </label>
          {userSite === "tous" ? (
            <div
              className="section-tabs catalogue-stock-tabs"
              role="tablist"
              aria-label="Point de vente"
              style={{ marginBottom: 0 }}
            >
              <button
                type="button"
                role="tab"
                className={`section-tab${site === "zogbo" ? " is-active" : ""}`}
                onClick={() => setSite("zogbo")}
              >
                Zogbo
              </button>
              <button
                type="button"
                role="tab"
                className={`section-tab${site === "gbegamey" ? " is-active" : ""}`}
                onClick={() => setSite("gbegamey")}
              >
                Gbégamey
              </button>
            </div>
          ) : (
            <span className="achats-pill" style={{ alignSelf: "flex-end" }}>
              {site === "zogbo" ? "Zogbo" : "Gbégamey"}
            </span>
          )}
        </div>

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
                onClick={() => void charger(date, site)}
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
            Une perte n&apos;est pas une vente : elle sort du stock avec un
            motif obligatoire. Annuler une déclaration reprend le stock.
          </p>
        </div>

        <div className="achats-kpi-grid" aria-label="Totaux pertes">
          <div className="achats-kpi achats-kpi-warn">
            <span className="achats-kpi-ico" aria-hidden>
              ₣
            </span>
            <div>
              <span className="catalogue-kpi-label">Pertes du jour</span>
              <strong className="catalogue-kpi-value">
                {loading ? "…" : formatFcfa(coutDuJour)}
              </strong>
              <span className="achats-kpi-hint">
                Coût des déclarations actives
              </span>
            </div>
          </div>
          <div className="achats-kpi achats-kpi-blue">
            <span className="achats-kpi-ico" aria-hidden>
              ≡
            </span>
            <div>
              <span className="catalogue-kpi-label">Déclarations</span>
              <strong className="catalogue-kpi-value">
                {loading ? "…" : actives.length}
              </strong>
              <span className="achats-kpi-hint">Hors lignes annulées</span>
            </div>
          </div>
        </div>

        <div
          className="section-tabs catalogue-stock-tabs"
          role="tablist"
          aria-label="Famille"
        >
          {FAMILLES.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={famille === f.key}
              className={`section-tab${famille === f.key ? " is-active" : ""}`}
              onClick={() => {
                setFamille(f.key);
                setProductId("");
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <section className="catalogue-panel" ref={formRef} id="nouvelle-perte">
          <div className="catalogue-toolbar">
            <h2 className="panel-title" style={{ margin: 0 }}>
              Déclarer une perte
            </h2>
          </div>
          <form className="pertes-form-grid" onSubmit={declarer}>
            <label className="achats-field">
              <span className="achats-field-label">Produit</span>
              <select
                className="input-select"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                required
              >
                <option value="">— choisir —</option>
                {candidats.map((c) => (
                  <option key={c.productId} value={c.productId}>
                    {c.name}
                    {c.stock !== null ? ` (reste ${c.stock})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="achats-field">
              <span className="achats-field-label">
                Quantité {enBouteilles ? "(bt)" : ""}
              </span>
              <input
                type="number"
                className="input-num"
                inputMode="numeric"
                min={1}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
            </label>
            <label className="achats-field">
              <span className="achats-field-label">Motif</span>
              <select
                className="input-select"
                value={motif}
                onChange={(e) => setMotif(e.target.value as PerteMotif)}
              >
                {MOTIFS.map(([cle, libelle]) => (
                  <option key={cle} value={cle}>
                    {libelle}
                  </option>
                ))}
              </select>
            </label>
            <label className="achats-field">
              <span className="achats-field-label">
                Commentaire {motif === "autre" ? "(obligatoire)" : ""}
              </span>
              <input
                type="text"
                className="input-text"
                maxLength={300}
                placeholder="Ce qui s'est passé"
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                required={motif === "autre"}
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary achats-form-submit"
              disabled={busy || loading || !productId || !qty}
            >
              {busy ? "…" : "+ Déclarer"}
            </button>
          </form>
          {choisi && choisi.stock !== null ? (
            <p className="catalogue-drinks-hint">
              {famille === "libre"
                ? "Reste disponible sur cet achat"
                : famille === "immobilisation"
                  ? "Quantité en registre"
                  : "Stock actuel"}
              {" : "}
              <strong>
                {choisi.stock}
                {enBouteilles ? " bouteille(s)" : ""}
              </strong>
            </p>
          ) : (
            <p className="catalogue-drinks-hint">
              Choisissez la famille, le produit, la quantité et le motif. Le
              stock est décrémenté à l&apos;enregistrement.
            </p>
          )}
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
                  placeholder="Rechercher une perte…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Rechercher une perte"
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
                  <div
                    className="achats-filters-panel"
                    role="group"
                    aria-label="Filtres statut"
                  >
                    {(
                      [
                        ["all", "Tous"],
                        ["actif", "Actives"],
                        ["annule", "Annulées"],
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
                  {pertes.length === 0
                    ? "Aucune perte déclarée ce jour"
                    : "Aucune perte trouvée"}
                </p>
                <p className="catalogue-empty-hint">
                  {pertes.length === 0
                    ? "Déclarez une perte ci-dessus si un stock a disparu hors vente."
                    : "Modifiez votre recherche ou vos filtres."}
                </p>
              </div>
            ) : (
              <>
                <div className="catalogue-table-wrap stock-zogbo-desktop-table">
                  <table className="catalogue-table">
                    <thead>
                      <tr>
                        <th scope="col">Heure</th>
                        <th scope="col">Désignation</th>
                        <th scope="col">Famille</th>
                        <th scope="col">Qté</th>
                        <th scope="col">Motif</th>
                        <th scope="col">Coût</th>
                        <th scope="col">Statut</th>
                        <th scope="col" className="col-actions">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.items.map((p) => (
                        <tr
                          key={p.id}
                          className={p.cancelledAt ? "row-warn" : undefined}
                        >
                          <td>{formatHeure(p.at)}</td>
                          <td>
                            <span className="catalogue-product-name achats-name">
                              {p.name}
                            </span>
                            {p.commentaire ? (
                              <div className="muted" style={{ fontWeight: 400 }}>
                                {p.commentaire}
                              </div>
                            ) : null}
                          </td>
                          <td>{familleLabel(p.kind)}</td>
                          <td>
                            <span className="catalogue-qty-badge">
                              {p.qty}
                            </span>
                          </td>
                          <td>{PERTE_MOTIF_LABELS[p.motif]}</td>
                          <td>
                            <span className="catalogue-price-badge catalogue-price-badge-warn">
                              {formatFcfa(p.cost)}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`achats-status${p.cancelledAt ? " achats-status-warn" : " achats-status-ok"}`}
                            >
                              {p.cancelledAt ? "Annulé" : "Validé"}
                            </span>
                          </td>
                          <td className="col-actions">
                            {!p.cancelledAt ? (
                              <button
                                type="button"
                                className="catalogue-action-btn is-danger"
                                disabled={busy}
                                aria-label={`Annuler ${p.name}`}
                                onClick={() => void annuler(p)}
                              >
                                ×
                              </button>
                            ) : (
                              <span className="muted">
                                {p.cancelledByName ?? "—"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="stock-zogbo-mobile-list">
                  {paged.items.map((p) => (
                    <article
                      key={p.id}
                      className={`stock-mobile-card${p.cancelledAt ? " is-warn" : ""}`}
                    >
                      <div className="stock-mobile-card-head">
                        <span className="catalogue-product-name">{p.name}</span>
                        <span
                          className={`achats-status${p.cancelledAt ? " achats-status-warn" : " achats-status-ok"}`}
                        >
                          {p.cancelledAt ? "Annulé" : "Validé"}
                        </span>
                      </div>
                      <div className="catalogue-mobile-card-prices">
                        <div>
                          <span className="catalogue-mobile-price-label">
                            Heure
                          </span>
                          <strong>{formatHeure(p.at)}</strong>
                        </div>
                        <div>
                          <span className="catalogue-mobile-price-label">
                            Qté
                          </span>
                          <strong>{p.qty}</strong>
                        </div>
                        <div>
                          <span className="catalogue-mobile-price-label">
                            Motif
                          </span>
                          <strong>{PERTE_MOTIF_LABELS[p.motif]}</strong>
                        </div>
                        <div>
                          <span className="catalogue-mobile-price-label">
                            Coût
                          </span>
                          <strong>{formatFcfa(p.cost)}</strong>
                        </div>
                      </div>
                      <p className="catalogue-meta" style={{ margin: 0 }}>
                        {familleLabel(p.kind)}
                        {p.actorName ? ` · ${p.actorName}` : ""}
                        {p.commentaire ? ` · ${p.commentaire}` : ""}
                      </p>
                      {!p.cancelledAt ? (
                        <div className="catalogue-mobile-card-actions">
                          <button
                            type="button"
                            className="catalogue-action-btn is-danger"
                            disabled={busy}
                            onClick={() => void annuler(p)}
                          >
                            Annuler
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>

                <CataloguePaginationBar
                  from={paged.from}
                  to={paged.to}
                  total={paged.total}
                  page={paged.page}
                  totalPages={paged.totalPages}
                  onPage={setPage}
                  itemLabel="perte"
                />
              </>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
