"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import { downloadExcel, excelFilename } from "@/lib/export-excel";
import { ContextBar } from "@/components/context-bar";
import { ProductIcon } from "@/components/product-icon";
import { QtyInput } from "@/components/qty-input";
import { EcartBadge, formatEcart } from "@/components/stock-ecart";
import { ZoneBoissonsPanel } from "@/components/zone/zone-boissons-panel";
import { CondimentsPanel } from "@/components/condiments/condiments-panel";
import {
  CataloguePaginationBar,
  CatalogueSkeleton,
} from "@/components/parametres/catalogue-view";
import { useSession } from "@/components/session-provider";
import "@/components/parametres/parametres-catalogue.css";
import { canWriteStock } from "@/lib/auth-types";
import type { VenteSite } from "@/lib/types";
import type {
  PlatUnitStats,
  StockUnit,
  StockUnitKind,
  StockZogboPayload,
} from "@/lib/stock-unit-types";
import {
  formatDisplayDate,
  todayIsoDate,
} from "@/lib/zogbo-calc";

type TabKey = "plats" | "boissons" | "condiments";

const PAGE_SIZE = 6;

function parseTab(raw: string | null): TabKey {
  if (raw === "boissons" || raw === "condiments") return raw;
  return "plats";
}

function sumPlats(plats: PlatUnitStats[], key: keyof PlatUnitStats): number {
  return plats.reduce((s, p) => s + (Number(p[key]) || 0), 0);
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

function matchesSearch(name: string, query: string): boolean {
  if (!query) return true;
  return normalizeSearch(name).includes(normalizeSearch(query));
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

function StockSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="catalogue-search-wrap">
      <span className="catalogue-search-icon" aria-hidden>
        ⌕
      </span>
      <input
        type="search"
        className="catalogue-search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function StockAddControls({
  productId,
  productName,
  kind,
  draftQr,
  onDraft,
  busy,
  onAdd,
}: {
  productId: string;
  productName: string;
  kind: StockUnitKind;
  draftQr: Record<string, string>;
  onDraft: (key: string, value: string) => void;
  busy: string | null;
  onAdd: (productId: string, kind: StockUnitKind) => void;
}) {
  const draftKey = kind === "plat" ? productId : `${kind}:${productId}`;
  const busyKey = `qr-${kind}-${productId}`;
  return (
    <div className="catalogue-inline-qr">
      <input
        type="number"
        min={1}
        className="input input-qty"
        placeholder="Qté"
        aria-label={`Quantité préparée — ${productName}`}
        value={draftQr[draftKey] ?? ""}
        onChange={(e) => onDraft(draftKey, e.target.value)}
      />
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={busy === busyKey}
        aria-label={`Enregistrer le stock — ${productName}`}
        onClick={() => onAdd(productId, kind)}
      >
        {busy === busyKey ? "…" : "+"}
      </button>
    </div>
  );
}

function StockErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="catalogue-alert catalogue-alert-danger" role="alert">
      <span className="catalogue-alert-icon" aria-hidden>
        !
      </span>
      <span>
        {message}
        {onRetry ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm catalogue-retry"
            onClick={onRetry}
          >
            Réessayer
          </button>
        ) : null}
      </span>
    </div>
  );
}

export function StockZogboPage({
  site = "zogbo",
}: {
  site?: VenteSite;
}) {
  const isGbegamey = site === "gbegamey";
  const apiBase = isGbegamey ? "/api/stock-gbegamey" : "/api/stock-zogbo";
  const siteTitle = isGbegamey ? "Stock Gbégamey" : "Stock Zogbo";
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useSession();
  const readOnly = Boolean(user && !canWriteStock(user.role));
  const tabDemande = parseTab(searchParams.get("tab"));
  // Le magasin de condiments n'est ouvert qu'à Gbégamey pour l'instant.
  const tab = tabDemande === "condiments" && !isGbegamey ? "plats" : tabDemande;
  const dateFromUrl = searchParams.get("date");
  const [date, setDate] = useState(() => {
    if (dateFromUrl && /^\d{4}-\d{2}-\d{2}$/.test(dateFromUrl)) return dateFromUrl;
    return todayIsoDate();
  });
  const [payload, setPayload] = useState<StockZogboPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draftQr, setDraftQr] = useState<Record<string, string>>({});
  const [platSearch, setPlatSearch] = useState("");
  const [platPage, setPlatPage] = useState(1);

  const debouncedPlatSearch = useDebouncedValue(platSearch);

  const plats = payload?.plats ?? [];

  const totals = useMemo(
    () => ({
      prepared: sumPlats(plats, "entrees"),
      remaining: sumPlats(plats, "stockRemaining"),
      sold: sumPlats(plats, "soldAggregate"),
    }),
    [plats],
  );

  function setTab(next: TabKey) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "plats") params.delete("tab");
    else params.set("tab", next);
    const q = params.toString();
    const path = isGbegamey ? "/stock-gbegamey" : "/stock-zogbo";
    router.replace(q ? `${path}?${q}` : path);
  }

  const load = useCallback(async (nextDate = date) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/${isGbegamey ? "stock-gbegamey" : "stock-zogbo"}?date=${encodeURIComponent(nextDate)}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as StockZogboPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Chargement impossible.");
      setPayload(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }, [date, apiBase]);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  async function postAction(
    action: string,
    data: Record<string, unknown>,
  ): Promise<StockZogboPayload | null> {
    const res = await fetch(apiBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, action, ...data }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Opération refusée.");
    const next = body.payload as StockZogboPayload;
    if (next) {
      setPayload(next);
    }
    return next;
  }

  async function saveCounted(productId: string, counted: number | null) {
    if (readOnly) return;
    const current = plats.find((p) => p.productId === productId)?.counted ?? null;
    if (current === counted) return;
    setBusy(`count-${productId}`);
    setError(null);
    try {
      await postAction("save-counted", { productId, counted });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur enregistrement stock réel.");
    } finally {
      setBusy(null);
    }
  }

  async function registerStock(
    productId: string,
    kind: StockUnitKind = "plat",
  ) {
    if (readOnly) return;
    const draftKey = kind === "plat" ? productId : `${kind}:${productId}`;
    const qty = Math.round(Number(draftQr[draftKey]) || 0);
    if (qty <= 0) {
      setError("Indiquez d’abord la quantité de stock.");
      return;
    }
    setBusy(`qr-${kind}-${productId}`);
    setError(null);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          action: "register-stock",
          productId,
          qty,
          kind,
          generateQr: false,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Opération refusée.");
      if (body.payload) {
        setPayload(body.payload as StockZogboPayload);
      }
      setDraftQr((d) => ({ ...d, [draftKey]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur enregistrement stock.");
    } finally {
      setBusy(null);
    }
  }

  const filteredPlats = useMemo(
    () =>
      plats.filter((p) => matchesSearch(p.productName, debouncedPlatSearch)),
    [plats, debouncedPlatSearch],
  );

  const pagedPlats = useMemo(
    () => paginate(filteredPlats, platPage, PAGE_SIZE),
    [filteredPlats, platPage],
  );

  /** Cumul depuis le début (SI fixe) : entrées, disponible, vendus, théorique. */

  const patchDraftQr = (key: string, value: string) => {
    setDraftQr((d) => ({ ...d, [key]: value }));
  };

  useEffect(() => {
    setPlatPage(1);
  }, [debouncedPlatSearch]);

  return (
    <AppShell
      title={siteTitle}
      subtitle={
        readOnly
          ? "Consultation du stock — aucune saisie."
          : "Saisie du stock — plats et boissons."
      }
      mainClassName="main-stock-zogbo"
      actions={
        tab === "boissons" || tab === "condiments" ? undefined : (
          <ExportExcelButton
            disabled={loading || !payload}
            className="btn btn-ghost"
            onExport={() => {
              downloadExcel(excelFilename("stock", site, date), [
                {
                  name: "Plats",
                  subtitle: `${siteTitle} · ${date}`,
                  rows: plats.map((p) => ({
                    Plat: p.productName,
                    "Stock initial": p.si ?? "",
                    Entrées: p.entrees,
                    "Stock disponible": p.disponible,
                    Vendus: p.soldAggregate,
                    "Stock théorique": p.theoretical ?? "",
                    "Stock physique": p.counted ?? "",
                    Écart: p.ecart ?? "",
                  })),
                },
              ]);
              return Promise.resolve();
            }}
          />
        )
      }
    >
      <div className="stock-zogbo-page catalogue-view">
        <ContextBar
          date={date}
          onDateChange={setDate}
          siteLabel={isGbegamey ? "Gbégamey" : "Zogbo"}
        />

        <div
          className="section-tabs catalogue-stock-tabs"
          role="tablist"
          aria-label={`Sections ${siteTitle}`}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "plats"}
            className={`section-tab${tab === "plats" ? " is-active" : ""}`}
            onClick={() => setTab("plats")}
          >
            Plats
            <span className="section-count">{plats.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "boissons"}
            className={`section-tab${tab === "boissons" ? " is-active" : ""}`}
            onClick={() => setTab("boissons")}
          >
            Boissons
          </button>
          {isGbegamey ? (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "condiments"}
              className={`section-tab${tab === "condiments" ? " is-active" : ""}`}
              onClick={() => setTab("condiments")}
            >
              Condiments
            </button>
          ) : null}
        </div>

        {error ? (
          <StockErrorBanner message={error} onRetry={() => void load(date)} />
        ) : null}

        {readOnly ? (
          <div className="catalogue-info" role="note">
            <span className="catalogue-info-mark" aria-hidden>
              i
            </span>
            <p>Consultation uniquement — vous ne pouvez pas saisir de stock.</p>
          </div>
        ) : null}

        {tab === "condiments" ? (
          <CondimentsPanel readOnly={readOnly} />
        ) : loading ? (
          <CatalogueSkeleton />
        ) : tab === "plats" ? (
          <>
            <div className="catalogue-kpi-grid" aria-label="Totaux du jour">
              <div className="catalogue-kpi">
                <span className="catalogue-kpi-label">Entrées</span>
                <strong className="catalogue-kpi-value">{totals.prepared}</strong>
              </div>
              <div className="catalogue-kpi catalogue-kpi-accent">
                <span className="catalogue-kpi-label">
                  Stock théorique
                </span>
                <strong className="catalogue-kpi-value">{totals.remaining}</strong>
              </div>
              <div className="catalogue-kpi">
                <span className="catalogue-kpi-label">Vendus</span>
                <strong className="catalogue-kpi-value">{totals.sold}</strong>
              </div>
            </div>

            <p className="catalogue-meta">
              <span className="catalogue-meta-icon" aria-hidden>
                📅
              </span>
              <strong>{formatDisplayDate(date)}</strong>
              {" · "}
              Stock du jour {isGbegamey ? "Gbégamey" : "Zogbo"}.
            </p>

            <div className="catalogue-info" role="note">
              <span className="catalogue-info-mark" aria-hidden>
                i
              </span>
              <p>
                {readOnly
                  ? "Les plats du jour et les ventes s’affichent ici."
                  : "Saisissez la quantité puis + pour enregistrer le stock. L’écart compare le stock réel (comptage) au stock théorique."}
              </p>
            </div>

            <div
              className={`stock-zogbo-layout-premium${readOnly ? " is-readonly" : ""}`}
            >
              <section className="catalogue-panel stock-zogbo-main">
                <div className="catalogue-toolbar">
                  <StockSearch
                    value={platSearch}
                    onChange={setPlatSearch}
                    placeholder="Rechercher un plat…"
                  />
                </div>

                {filteredPlats.length === 0 ? (
                  <div className="catalogue-empty">
                    <p className="catalogue-empty-title">Aucun plat trouvé</p>
                    <p className="catalogue-empty-hint">
                      Modifiez votre recherche.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="catalogue-table-wrap stock-zogbo-desktop-table">
                      <table className="catalogue-table stock-zogbo-table stock-modele-table">
                        <thead>
                          <tr>
                            <th scope="col">Plat</th>
                            <th scope="col" className="col-qty">Stock initial</th>
                            <th scope="col" className="col-qty">Entrées</th>
                            <th scope="col" className="col-qty">Stock disponible</th>
                            <th scope="col" className="col-qty">Vendus</th>
                            <th scope="col" className="col-qty">Stock théorique</th>
                            <th scope="col" className="col-qty">Stock physique</th>
                            <th scope="col" className="col-qty">Écart</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedPlats.items.map((row) => (
                            <tr key={row.productId}>
                              <td>
                                <div className="catalogue-product-cell">
                                  <ProductIcon kind="plat" name={row.productName} />
                                  <span className="catalogue-product-name">{row.productName}</span>
                                </div>
                              </td>
                              <td>
                                <span className="catalogue-qty-badge">{row.si ?? "—"}</span>
                              </td>
                              <td>
                                <div className="stock-prepared-cell">
                                  <span className="catalogue-qty-badge">{row.entrees}</span>
                                  {readOnly ? null : (
                                    <StockAddControls
                                      productId={row.productId}
                                      productName={row.productName}
                                      kind="plat"
                                      draftQr={draftQr}
                                      onDraft={patchDraftQr}
                                      busy={busy}
                                      onAdd={registerStock}
                                    />
                                  )}
                                </div>
                              </td>
                              <td>
                                <span className="catalogue-qty-badge">{row.disponible}</span>
                              </td>
                              <td>
                                <span className="catalogue-qty-badge">{row.soldAggregate}</span>
                              </td>
                              <td>
                                <span
                                  className={`catalogue-qty-badge catalogue-qty-badge-accent stock-remaining-badge${
                                    (row.theoretical ?? 0) <= 0 ? " is-empty" : ""
                                  }`}
                                >
                                  {row.theoretical ?? 0}
                                </span>
                              </td>
                              <td>
                                {readOnly ? (
                                  <span className="catalogue-qty-badge">{row.counted ?? "—"}</span>
                                ) : (
                                  <QtyInput
                                    value={row.counted}
                                    allowEmpty
                                    ariaLabel={`Stock physique ${row.productName}`}
                                    onChange={(counted) => void saveCounted(row.productId, counted)}
                                  />
                                )}
                              </td>
                              <td>
                                <EcartBadge value={row.ecart} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="stock-zogbo-mobile-list">
                      {pagedPlats.items.map((row) => (
                        <article key={row.productId} className="stock-mobile-card">
                          <div className="stock-mobile-card-head">
                            <ProductIcon
                              kind="plat"
                              name={row.productName}
                              size="lg"
                            />
                            <span className="catalogue-product-name">
                              {row.productName}
                            </span>
                          </div>
                          <div className="stock-mobile-metrics">
                            <Metric label="Stock initial" value={row.si ?? "—"} />
                            <Metric label="Entrées" value={row.entrees} />
                            <Metric label="Stock disponible" value={row.disponible} />
                            <Metric label="Vendus" value={row.soldAggregate} />
                            <Metric label="Stock théorique" value={row.theoretical ?? 0} accent />
                            <Metric label="Stock physique" value={row.counted ?? "—"} />
                            <Metric label="Écart" value={formatEcart(row.ecart)} />
                          </div>
                          {readOnly ? null : (
                            <div className="stock-mobile-actions">
                              <QtyInput
                                value={row.counted}
                                allowEmpty
                                placeholder="Stock physique"
                                ariaLabel={`Stock physique ${row.productName}`}
                                onChange={(counted) =>
                                  void saveCounted(row.productId, counted)
                                }
                              />
                              <StockAddControls
                                productId={row.productId}
                                productName={row.productName}
                                kind="plat"
                                draftQr={draftQr}
                                onDraft={patchDraftQr}
                                busy={busy}
                                onAdd={registerStock}
                              />
                            </div>
                          )}
                        </article>
                      ))}
                    </div>

                    <CataloguePaginationBar
                      from={pagedPlats.from}
                      to={pagedPlats.to}
                      total={pagedPlats.total}
                      page={pagedPlats.page}
                      totalPages={pagedPlats.totalPages}
                      onPage={setPlatPage}
                    />
                  </>
                )}
              </section>
            </div>
          </>
        ) : (
          <ZoneBoissonsPanel
            date={date}
            site={site}
            premium
            readOnly={readOnly}
          />
        )}
      </div>
    </AppShell>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className={`stock-mobile-metric${accent ? " stock-mobile-metric-accent" : ""}`}>
      <span className="stock-mobile-metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
