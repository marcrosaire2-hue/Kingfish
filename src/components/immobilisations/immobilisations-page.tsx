"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import {
  CataloguePaginationBar,
  CatalogueSkeleton,
} from "@/components/parametres/catalogue-view";
import "@/components/parametres/parametres-catalogue.css";
import { formatDateFr } from "@/components/achats/achats-shared";
import { formatFcfa } from "@/lib/format";
import type { Immobilisation, ImmobilisationKind } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

type TabKey = ImmobilisationKind;

type Draft = {
  name: string;
  qty: string;
  unit: string;
  cost: string;
  salePrice: string;
  date: string;
  dureeUtiliteAnnees: string;
};

const PAGE_SIZE = 10;

function emptyDraft(): Draft {
  return {
    name: "",
    qty: "1",
    unit: "pièce",
    cost: "",
    salePrice: "",
    date: todayIsoDate(),
    dureeUtiliteAnnees: "",
  };
}

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

export function ImmobilisationsPage() {
  const formRef = useRef<HTMLElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<TabKey>("emballage");
  const [items, setItems] = useState<Immobilisation[]>([]);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [amortissementsActifs, setAmortissementsActifs] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(search);

  useEffect(() => {
    let annule = false;
    void (async () => {
      try {
        const res = await fetch("/api/parametres-comptables", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = await res.json();
        if (!annule) setAmortissementsActifs(!!body.modules?.amortissements);
      } catch {
        /* module non critique pour cette page */
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ kind: tab });
      if (!showInactive) params.set("active", "1");
      const res = await fetch(`/api/immobilisations?${params}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setItems((body.items as Immobilisation[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, showInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredBase = useMemo(
    () => (showInactive ? items : items.filter((i) => i.active)),
    [items, showInactive],
  );

  const filtered = useMemo(() => {
    const q = normalizeSearch(debouncedSearch);
    if (!q) return filteredBase;
    return filteredBase.filter((i) =>
      normalizeSearch([i.name, i.unit, i.date].join(" ")).includes(q),
    );
  }, [filteredBase, debouncedSearch]);

  const paged = useMemo(
    () => paginate(filtered, page, PAGE_SIZE),
    [filtered, page],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, tab, showInactive]);

  const totals = useMemo(() => {
    const inventaire = filtered.reduce((s, i) => s + i.qty * i.cost, 0);
    const vente = filtered.reduce((s, i) => s + i.qty * (i.salePrice ?? 0), 0);
    return { inventaire, vente };
  }, [filtered]);

  function startEdit(item: Immobilisation) {
    setEditId(item.id);
    setDraft({
      name: item.name,
      qty: String(item.qty),
      unit: item.unit || "pièce",
      cost: item.cost ? String(item.cost) : "",
      salePrice: item.salePrice != null ? String(item.salePrice) : "",
      date: item.date,
      dureeUtiliteAnnees:
        item.dureeUtiliteAnnees != null ? String(item.dureeUtiliteAnnees) : "",
    });
    setFlash(null);
    setError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetForm() {
    setEditId(null);
    setDraft(emptyDraft());
  }

  function focusNew() {
    resetForm();
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => nameInputRef.current?.focus(), 280);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const payload = {
        name: draft.name,
        kind: tab,
        qty: Math.round(Number(draft.qty) || 0),
        unit: draft.unit.trim() || "pièce",
        cost: Math.round(Number(draft.cost) || 0),
        salePrice: draft.salePrice
          ? Math.round(Number(draft.salePrice) || 0)
          : null,
        date: draft.date,
        dureeUtiliteAnnees:
          amortissementsActifs && tab === "actif" && draft.dureeUtiliteAnnees
            ? Math.round(Number(draft.dureeUtiliteAnnees) || 0)
            : null,
      };

      const res = await fetch("/api/immobilisations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editId
            ? { action: "update", id: editId, ...payload }
            : { action: "create", ...payload },
        ),
      });
      const body = (await res.json()) as {
        item?: Immobilisation;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible");
      const montant = payload.qty * payload.cost;
      const base = editId ? "Fiche mise à jour" : "Fiche créée";
      setFlash(
        montant > 0
          ? body.item?.depenseId
            ? `${base} — dépense de ${formatFcfa(montant)} créée à la caisse.`
            : `${base} — caisse fermée : aucune dépense liée.`
          : base,
      );
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(item: Immobilisation) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/immobilisations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setActive",
          id: item.id,
          active: !item.active,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Action impossible");
      setFlash(item.active ? "Désactivé" : "Réactivé");
      if (editId === item.id) resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Immobilisations"
      subtitle="Registre des immobilisations et emballages : date d'acquisition, désignation, quantité, coût d'acquisition, valeur."
      mainClassName="main-immo"
      actions={
        <>
          <Link href="/vente" className="btn btn-ghost achats-header-btn">
            Vente
          </Link>
          <button type="button" className="btn btn-primary" onClick={focusNew}>
            + Nouvelle fiche
          </button>
        </>
      }
    >
      <div className="catalogue-view">
        <p className="achats-pill" role="status">
          <span className="achats-pill-icon" aria-hidden>
            ■
          </span>
          {tab === "emballage"
            ? "Emballages — revendus en caisse"
            : "Actifs — matériel durable"}
        </p>

        <div
          className="section-tabs catalogue-stock-tabs"
          role="tablist"
          aria-label="Type d'immobilisation"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "emballage"}
            className={`section-tab${tab === "emballage" ? " is-active" : ""}`}
            onClick={() => {
              setTab("emballage");
              resetForm();
            }}
          >
            Emballages
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "actif"}
            className={`section-tab${tab === "actif" ? " is-active" : ""}`}
            onClick={() => {
              setTab("actif");
              resetForm();
            }}
          >
            Actifs / matériel
          </button>
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
                onClick={() => void load()}
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
            {tab === "emballage" ? (
              <>
                Les emballages actifs avec une valeur vente apparaissent sur{" "}
                <strong>Vente</strong> (Rapido) pour ajout au panier. Pour un
                emballage consommé en cuisine (non revendu), utilisez plutôt{" "}
                <Link href="/achats">Achats</Link>.
              </>
            ) : (
              <>
                Équipements et matériel durables (frigo, tables, balance…) —
                hors facturation caisse. Pour des ingrédients ou fournitures
                consommées au quotidien, utilisez{" "}
                <Link href="/achats">Achats</Link>.
              </>
            )}
          </p>
        </div>

        <div className="achats-kpi-grid" aria-label="Totaux immobilisations">
          <div className="achats-kpi achats-kpi-gold">
            <span className="achats-kpi-ico" aria-hidden>
              ₣
            </span>
            <div>
              <span className="catalogue-kpi-label">
                Total coût d&apos;acquisition
              </span>
              <strong className="catalogue-kpi-value">
                {loading ? "…" : formatFcfa(totals.inventaire)}
              </strong>
              <span className="achats-kpi-hint">Quantité × coût unitaire</span>
            </div>
          </div>
          <div className="achats-kpi achats-kpi-blue">
            <span className="achats-kpi-ico" aria-hidden>
              ≡
            </span>
            <div>
              <span className="catalogue-kpi-label">
                {tab === "emballage"
                  ? "Total prix de vente"
                  : "Total valeur estimée"}
              </span>
              <strong className="catalogue-kpi-value">
                {loading ? "…" : formatFcfa(totals.vente)}
              </strong>
              <span className="achats-kpi-hint">
                {filtered.length} fiche{filtered.length > 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>

        <section className="catalogue-panel" ref={formRef} id="nouvelle-fiche">
          <div className="catalogue-toolbar">
            <h2 className="panel-title" style={{ margin: 0 }}>
              {editId ? "Modifier la fiche" : "Nouvelle fiche"}
            </h2>
          </div>
          <div className="immo-form-grid">
            <label className="achats-field">
              <span className="achats-field-label">Date d&apos;acquisition</span>
              <input
                type="date"
                className="input-text"
                value={draft.date}
                max={todayIsoDate()}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, date: e.target.value }))
                }
              />
            </label>
            <label className="achats-field immo-field-full">
              <span className="achats-field-label">Désignation</span>
              <input
                ref={nameInputRef}
                className="input-text"
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                placeholder={
                  tab === "emballage"
                    ? "Ex. Boîte emporté, sachet…"
                    : "Ex. Frigo, table, balance…"
                }
              />
            </label>
            <label className="achats-field">
              <span className="achats-field-label">Quantité</span>
              <input
                type="number"
                min={1}
                className="input-num"
                value={draft.qty}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, qty: e.target.value }))
                }
              />
            </label>
            <label className="achats-field">
              <span className="achats-field-label">Unité</span>
              <input
                className="input-text"
                value={draft.unit}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, unit: e.target.value }))
                }
                placeholder="pièce, carton, kg…"
                list="immo-unit-suggestions"
                autoComplete="off"
              />
              <datalist id="immo-unit-suggestions">
                <option value="pièce" />
                <option value="carton" />
                <option value="paquet" />
                <option value="kg" />
                <option value="litre" />
                <option value="lot" />
              </datalist>
            </label>
            <label className="achats-field">
              <span className="achats-field-label">Coût d&apos;acquisition / u</span>
              <div className="achats-price-wrap">
                <input
                  type="number"
                  min={0}
                  className="input-num"
                  value={draft.cost}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, cost: e.target.value }))
                  }
                  placeholder="0"
                />
                <span className="achats-price-suffix">FCFA</span>
              </div>
            </label>
            <label className="achats-field">
              <span className="achats-field-label">
                {tab === "emballage" ? "Prix de vente / u" : "Valeur estimée / u"}
              </span>
              <div className="achats-price-wrap">
                <input
                  type="number"
                  min={0}
                  className="input-num"
                  value={draft.salePrice}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, salePrice: e.target.value }))
                  }
                  placeholder="Optionnel"
                />
                <span className="achats-price-suffix">FCFA</span>
              </div>
            </label>
            {tab === "actif" ? (
              <label className="achats-field">
                <span className="achats-field-label">
                  Durée d&apos;utilité (années)
                  {!amortissementsActifs ? " · module désactivé" : ""}
                </span>
                <input
                  type="number"
                  min={1}
                  className="input-num"
                  value={draft.dureeUtiliteAnnees}
                  disabled={!amortissementsActifs}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      dureeUtiliteAnnees: e.target.value,
                    }))
                  }
                  placeholder={
                    amortissementsActifs
                      ? "Ex. 5"
                      : "À activer (Comptabilité)"
                  }
                />
              </label>
            ) : null}
            <div className="immo-field-full" style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn btn-primary achats-form-submit"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy
                  ? "Enregistrement…"
                  : editId
                    ? "Enregistrer"
                    : "+ Créer"}
              </button>
              {editId ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={resetForm}
                >
                  Abandonner
                </button>
              ) : null}
            </div>
          </div>
          <p className="catalogue-drinks-hint">
            L&apos;acquisition crée une dépense de caisse (quantité × coût)
            lorsqu&apos;une caisse est ouverte — ne saisissez pas le même achat
            sur Achats.
          </p>
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
                  placeholder="Rechercher une fiche…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Rechercher une fiche"
                />
              </div>
              <div className="achats-filters">
                <button
                  type="button"
                  className={`catalogue-filter-btn${filtersOpen || showInactive ? " is-active" : ""}`}
                  aria-expanded={filtersOpen}
                  onClick={() => setFiltersOpen((v) => !v)}
                >
                  Filtres
                  {showInactive ? " · 1" : ""}
                </button>
                {filtersOpen ? (
                  <div className="achats-filters-panel" role="group">
                    <button
                      type="button"
                      className={`achats-filter-chip${!showInactive ? " is-active" : ""}`}
                      onClick={() => setShowInactive(false)}
                    >
                      Actives
                    </button>
                    <button
                      type="button"
                      className={`achats-filter-chip${showInactive ? " is-active" : ""}`}
                      onClick={() => setShowInactive(true)}
                    >
                      Inclure désactivées
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="catalogue-empty">
                <p className="catalogue-empty-title">Aucune fiche</p>
                <p className="catalogue-empty-hint">
                  {filteredBase.length === 0
                    ? "Créez une fiche ci-dessus."
                    : "Modifiez votre recherche ou vos filtres."}
                </p>
                {filteredBase.length === 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={focusNew}
                  >
                    + Nouvelle fiche
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
                        <th scope="col">Qté</th>
                        <th scope="col">Coût d&apos;acquisition</th>
                        <th scope="col">
                          {tab === "emballage"
                            ? "Prix de vente"
                            : "Valeur estimée"}
                        </th>
                        <th scope="col">Statut</th>
                        <th scope="col" className="col-actions">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.items.map((item) => (
                        <tr
                          key={item.id}
                          className={item.active ? undefined : "row-warn"}
                        >
                          <td>{formatDateFr(item.date)}</td>
                          <td>
                            <span className="catalogue-product-name achats-name">
                              {item.name}
                            </span>
                          </td>
                          <td>
                            <span className="catalogue-qty-badge">
                              {item.qty}
                            </span>{" "}
                            <span className="muted">{item.unit}</span>
                          </td>
                          <td>
                            <span className="catalogue-price-badge catalogue-price-badge-cost">
                              {formatFcfa(item.cost)}
                            </span>
                          </td>
                          <td>
                            {item.salePrice != null ? (
                              <span className="catalogue-price-badge catalogue-price-badge-sale">
                                {formatFcfa(item.salePrice)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            <span
                              className={`achats-status${item.active ? " achats-status-ok" : " achats-status-muted"}`}
                            >
                              {item.active ? "Actif" : "Désactivé"}
                            </span>
                          </td>
                          <td className="col-actions">
                            <div className="catalogue-row-actions">
                              <button
                                type="button"
                                className="catalogue-action-btn"
                                disabled={busy}
                                aria-label={`Modifier ${item.name}`}
                                onClick={() => startEdit(item)}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="catalogue-action-btn is-danger"
                                disabled={busy}
                                aria-label={
                                  item.active
                                    ? `Désactiver ${item.name}`
                                    : `Réactiver ${item.name}`
                                }
                                onClick={() => void toggleActive(item)}
                              >
                                {item.active ? "−" : "+"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="stock-zogbo-mobile-list">
                  {paged.items.map((item) => (
                    <article
                      key={item.id}
                      className={`stock-mobile-card${!item.active ? " is-warn" : ""}`}
                    >
                      <div className="stock-mobile-card-head">
                        <span className="catalogue-product-name">
                          {item.name}
                        </span>
                        <span
                          className={`achats-status${item.active ? " achats-status-ok" : " achats-status-muted"}`}
                        >
                          {item.active ? "Actif" : "Désactivé"}
                        </span>
                      </div>
                      <div className="catalogue-mobile-card-prices">
                        <div>
                          <span className="catalogue-mobile-price-label">
                            Date
                          </span>
                          <strong>{formatDateFr(item.date)}</strong>
                        </div>
                        <div>
                          <span className="catalogue-mobile-price-label">
                            Qté
                          </span>
                          <strong>
                            {item.qty} {item.unit}
                          </strong>
                        </div>
                        <div>
                          <span className="catalogue-mobile-price-label">
                            Coût
                          </span>
                          <strong>{formatFcfa(item.cost)}</strong>
                        </div>
                        <div>
                          <span className="catalogue-mobile-price-label">
                            {tab === "emballage" ? "PV" : "Valeur"}
                          </span>
                          <strong>
                            {item.salePrice != null
                              ? formatFcfa(item.salePrice)
                              : "—"}
                          </strong>
                        </div>
                      </div>
                      <div className="catalogue-mobile-card-actions">
                        <button
                          type="button"
                          className="catalogue-action-btn"
                          disabled={busy}
                          onClick={() => startEdit(item)}
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          className="catalogue-action-btn is-danger"
                          disabled={busy}
                          onClick={() => void toggleActive(item)}
                        >
                          {item.active ? "Désactiver" : "Réactiver"}
                        </button>
                      </div>
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
                  itemLabel="fiche"
                />
              </>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
