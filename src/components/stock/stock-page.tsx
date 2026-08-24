"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import { exportStockExcel } from "@/lib/page-exports";
import {
  STOCK_FAMILY_META,
  zoneFamily,
  zoneRoute,
  type StockFamily,
} from "@/lib/stock-meta";
import type { StockPayload, StockRow, StockZone } from "@/lib/stock-repo";
import { formatDisplayDate, todayIsoDate } from "@/lib/zogbo-calc";

type FamilyFilter = StockFamily | "all";
type AlertFilter = "none" | "ecarts" | "negatifs" | "seuil";

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function ecartClass(ecart: number): string {
  const sign = ecart < 0 ? " is-neg" : ecart > 0 ? " is-pos" : "";
  if (Math.abs(ecart) <= 1) return `mono stock-ecart is-warn${sign}`;
  return `mono stock-ecart is-bad${sign}`;
}

/** Formate une quantité et suffixe l'unité quand ce n'est pas des portions. */
function Qty({
  value,
  unit,
  strong,
}: {
  value: number | null;
  unit: string;
  strong?: boolean;
}) {
  if (value === null || value === undefined) return <>—</>;
  const display = Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 100) / 100);
  return (
    <>
      <span className={strong ? "stock-final" : undefined}>{display}</span>
      {unit !== "portions" ? <span className="cell-sub">{unit}</span> : null}
    </>
  );
}

type ZoneGroup = {
  zone: StockZone;
  label: string;
  rows: StockRow[];
};

export function StockPage() {
  const [date, setDate] = useState(() => todayIsoDate());
  const [data, setData] = useState<StockPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>("all");
  const [zoneFilter, setZoneFilter] = useState<StockZone | "all">("all");
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("none");
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date });
      const res = await fetch(`/api/stock?${params}`, { cache: "no-store" });
      const body = (await res.json()) as StockPayload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Alertes calculées sur toutes les lignes actives du jour. */
  const alerts = useMemo(() => {
    const rows = data?.rows ?? [];
    const ecarts = rows.filter((r) => r.ecart !== null && Math.abs(r.ecart) > 1);
    const negatifs = rows.filter(
      (r) => r.theorique < 0 || (r.compte !== null && r.compte - r.vendu < 0),
    );
    const seuil = rows.filter((r) => r.belowThreshold);
    return { ecarts, negatifs, seuil };
  }, [data]);

  const familyOptions = useMemo(() => {
    if (!data) return [];
    const present = new Set(data.rows.map((r) => zoneFamily(r.zone)));
    // Même sans ligne active, propose la famille demandée à l'API.
    for (const f of data.families ?? []) present.add(f);
    return STOCK_FAMILY_META.filter((m) => present.has(m.family));
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = norm(search.trim());
    return data.rows.filter((r) => {
      if (!showInactive) {
        const inactive =
          r.opening === 0 &&
          r.entrees === 0 &&
          r.envoye === 0 &&
          r.vendu === 0 &&
          r.pertes === 0 &&
          r.stockFinal === 0 &&
          r.compte === null &&
          !r.belowThreshold;
        if (inactive) return false;
      }
      if (familyFilter !== "all" && zoneFamily(r.zone) !== familyFilter) {
        return false;
      }
      if (zoneFilter !== "all" && r.zone !== zoneFilter) return false;
      if (alertFilter === "ecarts") {
        if (r.ecart === null || Math.abs(r.ecart) <= 1) return false;
      } else if (alertFilter === "negatifs") {
        if (!(r.theorique < 0 || (r.compte !== null && r.compte - r.vendu < 0))) {
          return false;
        }
      } else if (alertFilter === "seuil") {
        if (!r.belowThreshold) return false;
      }
      if (q && !norm(r.name).includes(q)) return false;
      return true;
    });
  }, [data, search, familyFilter, zoneFilter, alertFilter, showInactive]);

  const groups = useMemo((): ZoneGroup[] => {
    const map = new Map<StockZone, ZoneGroup>();
    for (const row of filteredRows) {
      let g = map.get(row.zone);
      if (!g) {
        g = { zone: row.zone, label: row.zoneLabel, rows: [] };
        map.set(row.zone, g);
      }
      g.rows.push(row);
    }
    const order = STOCK_FAMILY_META.flatMap((m) => m.zones);
    return [...map.values()].sort(
      (a, b) => order.indexOf(a.zone) - order.indexOf(b.zone),
    );
  }, [filteredRows]);

  const scopeLabel = useMemo(() => {
    if (!data?.scopeSite) return "Tous les sites";
    return data.scopeSite === "zogbo" ? "Zogbo" : "Gbégamey";
  }, [data]);

  const familyTotals = useMemo(() => {
    if (!data) return [];
    return STOCK_FAMILY_META.map((meta) => {
      const totals = data.totalsByZone.filter((t) =>
        meta.zones.includes(t.zone),
      );
      const lignes = totals.reduce((s, t) => s + t.lignes, 0);
      const stockFinal = totals.reduce((s, t) => s + t.stockFinal, 0);
      const vendu = totals.reduce((s, t) => s + t.vendu, 0);
      const stockVendable = totals.some((t) => t.stockVendable !== null)
        ? totals.reduce((s, t) => s + (t.stockVendable ?? 0), 0)
        : null;
      const alertes =
        alerts.negatifs.filter((r) => meta.zones.includes(r.zone)).length +
        alerts.seuil.filter((r) => meta.zones.includes(r.zone)).length +
        alerts.ecarts.filter((r) => meta.zones.includes(r.zone)).length;
      return {
        family: meta.family,
        label: meta.label,
        lignes,
        stockFinal: Math.round(stockFinal * 100) / 100,
        stockVendable,
        vendu,
        alertes,
      };
    }).filter((t) => t.lignes > 0 || (data.families ?? []).includes(t.family));
  }, [data, alerts]);

  function resetFilters() {
    setSearch("");
    setFamilyFilter("all");
    setZoneFilter("all");
    setAlertFilter("none");
  }

  function pickFamily(f: FamilyFilter) {
    setFamilyFilter(f);
    setZoneFilter("all");
  }

  function renderTable(rows: StockRow[]) {
    const kind = rows[0]?.kind ?? "plat";
    const isMatiere = kind === "matiere";
    const isBoisson = kind === "boisson";
    const showEnvoye = rows.some((r) => r.envoye > 0);
    const showVendable = !isMatiere && !isBoisson;
    const entreesLabel = isMatiere ? "Achats" : "Entrées";
    const venduLabel = isMatiere ? "Consommé" : "Vendu";
    const compteLabel = isBoisson ? "Compté (bt)" : "Compté";

    return (
      <div className="table-scroll">
        <table className="data-table stock-table">
          <thead>
            <tr>
              <th scope="col">Produit</th>
              <th scope="col" className="col-money">
                Ouverture
              </th>
              <th scope="col" className="col-money">
                {entreesLabel}
              </th>
              {showEnvoye ? (
                <th scope="col" className="col-money">
                  Envoyé Gbé
                </th>
              ) : null}
              <th scope="col" className="col-money">
                {venduLabel}
              </th>
              <th scope="col" className="col-money">
                Pertes
              </th>
              <th scope="col" className="col-money">
                Stock final
              </th>
              {showVendable ? (
                <th scope="col" className="col-money">
                  Vendable
                </th>
              ) : null}
              <th scope="col" className="col-money">
                Théorique
              </th>
              <th scope="col" className="col-money">
                {compteLabel}
              </th>
              <th scope="col" className="col-money">
                Écart
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const survente =
                row.theorique < 0 ||
                (row.compte !== null && row.compte - row.vendu < 0);
              const warnRow =
                survente ||
                (row.ecart !== null && Math.abs(row.ecart) > 1)
                  ? "row-warn"
                  : undefined;
              return (
                <tr key={`${row.zone}:${row.productId}`} className={warnRow}>
                  <td className="cell-name">
                    <Link href={zoneRoute(row.zone, date)} className="stock-zone-link">
                      <strong>{row.name}</strong>
                    </Link>
                    <span className="cell-sub">
                      {isMatiere && row.threshold
                        ? `Seuil ${row.threshold} ${row.unit}`
                        : row.kind === "plat"
                          ? "Plat"
                          : row.kind === "local"
                            ? "Accompagnement"
                            : row.kind === "boisson"
                              ? "Boisson"
                              : "Matière"}
                    </span>
                    {row.belowThreshold ? (
                      <span className="stock-ecart is-warn stock-chip-inline">
                        Sous le seuil
                      </span>
                    ) : null}
                  </td>
                  <td className="mono col-money">
                    <Qty value={row.opening} unit={row.unit} />
                  </td>
                  <td className="mono col-money">
                    <Qty value={row.entrees} unit={row.unit} />
                  </td>
                  {showEnvoye ? (
                    <td className="mono col-money">
                      <Qty value={row.envoye} unit={row.unit} />
                    </td>
                  ) : null}
                  <td className="mono col-money">
                    <Qty value={row.vendu} unit={row.unit} />
                  </td>
                  <td className="mono col-money">
                    <Qty value={row.pertes} unit={row.unit} />
                  </td>
                  <td className="mono col-money">
                    <Qty value={row.stockFinal} unit={row.unit} strong />
                  </td>
                  {showVendable ? (
                    <td className="mono col-money">
                      <Qty value={row.stockVendable} unit={row.unit} />
                    </td>
                  ) : null}
                  <td className="mono col-money">
                    <Qty value={row.theorique} unit={row.unit} />
                  </td>
                  <td className="mono col-money">
                    {row.compte !== null ? (
                      <Qty value={row.compte} unit={row.unit} />
                    ) : (
                      <span className="muted">non compté</span>
                    )}
                  </td>
                  <td className={`col-money ${row.ecart !== null ? ecartClass(row.ecart) : "mono"}`}>
                    {row.ecart !== null ? (
                      <Qty value={row.ecart} unit={row.unit} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const hasFilters =
    search.trim() !== "" ||
    familyFilter !== "all" ||
    zoneFilter !== "all" ||
    alertFilter !== "none" ||
    showInactive;

  return (
    <AppShell
      title="Stock"
      subtitle="Inventaire complet du jour — plats, accompagnements, boissons et matières"
      actions={
        data ? (
          <ExportExcelButton
            label="Exporter Excel"
            onExport={() => exportStockExcel(data)}
          />
        ) : undefined
      }
    >
      <div className="stock-page">
        <ContextBar date={date} onDateChange={setDate} siteLabel={scopeLabel}>
          <input
            type="search"
            className="name-input stock-search"
            placeholder="Rechercher un produit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Rechercher un produit"
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setDate(todayIsoDate())}
          >
            Aujourd&apos;hui
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void load()}
            disabled={loading}
          >
            Actualiser
          </button>
        </ContextBar>

        {data ? (
          <div className="stock-day-meta">
            <span className="muted">{formatDisplayDate(date)}</span>
            {[
              ["zogbo", data.dayStatus.zogbo],
              ["gbegamey", data.dayStatus.gbegamey],
              ["boissons", data.dayStatus.boissons],
              ["matières", data.dayStatus.matieres],
            ]
              .filter(([, v]) => v)
              .map(([label, v]) => (
                <span key={label as string} className="context-pill">
                  {label as string} · {v as string}
                </span>
              ))}
            <label className="stock-inactive-toggle">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Lignes sans mouvement
            </label>
          </div>
        ) : null}

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <BrandLoader variant="ligne" label="Chargement du stock…" />
        ) : null}

        {!loading && data ? (
          <>
            <div className="section-tabs" role="tablist" aria-label="Alertes">
              <button
                type="button"
                role="tab"
                aria-selected={alertFilter === "ecarts"}
                className={`section-tab stock-alert-tab is-warn${
                  alertFilter === "ecarts" ? " is-active" : ""
                }`}
                onClick={() =>
                  setAlertFilter((a) => (a === "ecarts" ? "none" : "ecarts"))
                }
              >
                Écarts inventaire · {alerts.ecarts.length}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={alertFilter === "negatifs"}
                className={`section-tab stock-alert-tab is-bad${
                  alertFilter === "negatifs" ? " is-active" : ""
                }`}
                onClick={() =>
                  setAlertFilter((a) => (a === "negatifs" ? "none" : "negatifs"))
                }
              >
                Stocks négatifs · {alerts.negatifs.length}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={alertFilter === "seuil"}
                className={`section-tab stock-alert-tab is-accent${
                  alertFilter === "seuil" ? " is-active" : ""
                }`}
                onClick={() =>
                  setAlertFilter((a) => (a === "seuil" ? "none" : "seuil"))
                }
              >
                Sous le seuil · {alerts.seuil.length}
              </button>
              {hasFilters ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={resetFilters}
                >
                  Réinitialiser les filtres
                </button>
              ) : null}
            </div>

            <div className="dash-kpi-grid stock-kpi-grid">
              {familyTotals.map((t) => (
                <button
                  key={t.family}
                  type="button"
                  className={`dash-kpi stock-kpi-btn${
                    familyFilter === t.family ? " is-active" : ""
                  }${t.alertes > 0 ? " dash-kpi-warn" : ""}`}
                  onClick={() => pickFamily(familyFilter === t.family ? "all" : t.family)}
                >
                  <span className="dash-kpi-label">{t.label}</span>
                  <span className="dash-kpi-value mono">{t.stockFinal}</span>
                  <div className="stock-kpi-meta">
                    <span>
                      {t.lignes} actif{t.lignes > 1 ? "s" : ""} · sorties{" "}
                      <strong>{t.vendu}</strong>
                    </span>
                    {t.stockVendable !== null ? (
                      <span>
                        Vendable <strong>{t.stockVendable}</strong>
                      </span>
                    ) : null}
                    {t.alertes > 0 ? (
                      <span className="stock-ecart is-warn">
                        {t.alertes} alerte{t.alertes > 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>

            <div className="section-tabs" role="tablist" aria-label="Filtrer par famille">
              <button
                type="button"
                role="tab"
                aria-selected={familyFilter === "all"}
                className={`section-tab${familyFilter === "all" ? " is-active" : ""}`}
                onClick={() => pickFamily("all")}
              >
                Tout
              </button>
              {familyOptions.map((meta) => (
                <button
                  key={meta.family}
                  type="button"
                  role="tab"
                  aria-selected={familyFilter === meta.family}
                  className={`section-tab${familyFilter === meta.family ? " is-active" : ""}`}
                  onClick={() => pickFamily(meta.family)}
                >
                  {meta.label}
                </button>
              ))}
            </div>

            {groups.length === 0 ? (
              <p className="muted">
                Aucune ligne pour cette date
                {hasFilters ? " avec ces filtres" : ""}. Changez de date ou
                cochez « Lignes sans mouvement » pour voir tout le catalogue.
              </p>
            ) : (
              groups.map((g) => {
                const total = data.totalsByZone.find((t) => t.zone === g.zone);
                return (
                  <section key={g.zone} className="panel panel-wide stock-zone-panel">
                    <div className="stock-zone-head">
                      <div>
                        <h2 className="panel-title">
                          <Link href={zoneRoute(g.zone, date)} className="stock-zone-link">
                            {g.label}
                          </Link>
                        </h2>
                        <p className="muted stock-zone-hint">
                          {g.rows.length} produit{g.rows.length > 1 ? "s" : ""}
                          {total
                            ? ` · stock final ${Math.round(total.stockFinal * 100) / 100} · ${total.vendu} en sorties`
                            : null}
                          {" · "}
                          <Link href={zoneRoute(g.zone, date)} className="stock-zone-link">
                            ouvrir la fiche →
                          </Link>
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setZoneFilter(zoneFilter === g.zone ? "all" : g.zone)}
                      >
                        {zoneFilter === g.zone ? "Tout afficher" : "Isoler"}
                      </button>
                    </div>
                    {renderTable(g.rows)}
                  </section>
                );
              })
            )}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
