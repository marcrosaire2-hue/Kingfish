"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import { exportStockExcel } from "@/lib/page-exports";
import type { StockPayload, StockRow, StockZone } from "@/lib/stock-repo";
import { formatDisplayDate, todayIsoDate } from "@/lib/zogbo-calc";

function zoneHref(zone: StockZone, date: string): string {
  return zone.startsWith("zogbo")
    ? `/zogbo?date=${date}`
    : `/gbegamey?date=${date}`;
}

function ecartClass(ecart: number | null): string {
  if (ecart === null || ecart === 0) return "";
  if (Math.abs(ecart) <= 1) return "stock-ecart is-warn";
  return "stock-ecart is-bad";
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return String(n);
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
  const [zoneFilter, setZoneFilter] = useState<StockZone | "all">("all");

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

  const zoneOptions = useMemo(() => {
    if (!data) return [];
    return data.totalsByZone
      .map((t) => [t.zone, t.zoneLabel] as const)
      .sort((a, b) => a[1].localeCompare(b[1], "fr"));
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    if (zoneFilter === "all") return data.rows;
    return data.rows.filter((r) => r.zone === zoneFilter);
  }, [data, zoneFilter]);

  const groups = useMemo((): ZoneGroup[] => {
    const order = data?.totalsByZone.map((t) => t.zone) ?? [];
    const map = new Map<StockZone, ZoneGroup>();
    for (const row of filteredRows) {
      let g = map.get(row.zone);
      if (!g) {
        g = { zone: row.zone, label: row.zoneLabel, rows: [] };
        map.set(row.zone, g);
      }
      g.rows.push(row);
    }
    return [...map.values()].sort(
      (a, b) => order.indexOf(a.zone) - order.indexOf(b.zone),
    );
  }, [data, filteredRows]);

  const scopeLabel = useMemo(() => {
    if (!data?.scopeSite) return "Tous les sites";
    return data.scopeSite === "zogbo" ? "Zogbo" : "Gbégamey";
  }, [data]);

  const showEnvoye = useMemo(
    () =>
      zoneFilter === "all" ||
      zoneFilter === "zogbo-plats" ||
      filteredRows.some((r) => r.envoye > 0),
    [zoneFilter, filteredRows],
  );

  const globalTotals = useMemo(() => {
    if (!data) return null;
    return data.totalsByZone.reduce(
      (acc, t) => {
        acc.lignes += t.lignes;
        acc.stockFinal += t.stockFinal;
        acc.vendu += t.vendu;
        acc.ecarts += t.ecarts;
        return acc;
      },
      { lignes: 0, stockFinal: 0, vendu: 0, ecarts: 0 },
    );
  }, [data]);

  function renderTable(rows: StockRow[], hideZoneCol: boolean) {
    return (
      <div className="table-scroll">
        <table className="data-table stock-table">
          <thead>
            <tr>
              {!hideZoneCol ? <th scope="col">Zone</th> : null}
              <th scope="col">Produit</th>
              <th scope="col" className="col-money">
                Ouverture
              </th>
              <th scope="col" className="col-money">
                Entrées
              </th>
              {showEnvoye ? (
                <th scope="col" className="col-money">
                  Envoyé Gbé
                </th>
              ) : null}
              <th scope="col" className="col-money">
                Vendu
              </th>
              <th scope="col" className="col-money">
                Pertes
              </th>
              <th scope="col" className="col-money">
                Stock final
              </th>
              <th scope="col" className="col-money">
                Vendable
              </th>
              <th scope="col" className="col-money">
                Compté
              </th>
              <th scope="col" className="col-money">
                Écart
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = zoneHref(row.zone, date);
              const warnRow =
                row.ecart !== null && Math.abs(row.ecart) > 1
                  ? "row-warn"
                  : undefined;
              return (
                <tr key={`${row.zone}:${row.productId}`} className={warnRow}>
                  {!hideZoneCol ? (
                    <td>
                      <Link href={href} className="stock-zone-link">
                        {row.zoneLabel}
                      </Link>
                    </td>
                  ) : null}
                  <td className="cell-name">
                    <strong>{row.name}</strong>
                    <span className="cell-sub">
                      {row.kind === "plat" ? "Plat" : "Accompagnement"}
                    </span>
                  </td>
                  <td className="mono col-money">{fmt(row.opening)}</td>
                  <td className="mono col-money">{fmt(row.entrees)}</td>
                  {showEnvoye ? (
                    <td className="mono col-money">
                      {row.zone === "zogbo-plats" ? fmt(row.envoye) : "—"}
                    </td>
                  ) : null}
                  <td className="mono col-money">{fmt(row.vendu)}</td>
                  <td className="mono col-money">{fmt(row.pertes)}</td>
                  <td className="mono col-money stock-final">
                    {fmt(row.stockFinal)}
                  </td>
                  <td className="mono col-money">{fmt(row.stockVendable)}</td>
                  <td className="mono col-money">{fmt(row.compte)}</td>
                  <td
                    className={`mono col-money ${ecartClass(row.ecart)}`}
                  >
                    {fmt(row.ecart)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <AppShell
      title="Stock"
      subtitle="Inventaire du jour par site — ouverture, mouvements et reste théorique"
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
        <ContextBar
          date={date}
          onDateChange={setDate}
          siteLabel={scopeLabel}
        >
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
            {data.dayStatus.zogbo ? (
              <span className="context-pill">Zogbo · {data.dayStatus.zogbo}</span>
            ) : null}
            {data.dayStatus.gbegamey ? (
              <span className="context-pill">
                Gbégamey · {data.dayStatus.gbegamey}
              </span>
            ) : null}
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

        {!loading && data && globalTotals ? (
          <>
            <div className="dash-kpi-grid stock-kpi-grid">
              <div
                className={`dash-kpi${globalTotals.ecarts > 0 ? " dash-kpi-warn" : " dash-kpi-accent"}`}
              >
                <span className="dash-kpi-label">Vue d&apos;ensemble</span>
                <span className="dash-kpi-value mono">
                  {globalTotals.stockFinal}
                </span>
                <div className="stock-kpi-meta">
                  <span>
                    {globalTotals.lignes} ligne
                    {globalTotals.lignes > 1 ? "s" : ""} · vendu{" "}
                    <strong>{globalTotals.vendu}</strong>
                  </span>
                  {globalTotals.ecarts > 0 ? (
                    <span className="stock-ecart is-warn">
                      {globalTotals.ecarts} écart
                      {globalTotals.ecarts > 1 ? "s" : ""} inventaire
                    </span>
                  ) : (
                    <span>Inventaire aligné</span>
                  )}
                </div>
              </div>

              {data.totalsByZone.map((t) => (
                <button
                  key={t.zone}
                  type="button"
                  className={`dash-kpi stock-kpi-btn${
                    zoneFilter === t.zone ? " is-active" : ""
                  }${t.ecarts > 0 ? " dash-kpi-warn" : ""}`}
                  onClick={() =>
                    setZoneFilter((z) => (z === t.zone ? "all" : t.zone))
                  }
                >
                  <span className="dash-kpi-label">{t.zoneLabel}</span>
                  <span className="dash-kpi-value mono">{t.stockFinal}</span>
                  <div className="stock-kpi-meta">
                    <span>
                      {t.lignes} actif{t.lignes > 1 ? "s" : ""} · vendu{" "}
                      <strong>{t.vendu}</strong>
                    </span>
                    {t.stockVendable !== null ? (
                      <span>
                        Vendable <strong>{t.stockVendable}</strong>
                      </span>
                    ) : null}
                    {t.ecarts > 0 ? (
                      <span className="stock-ecart is-warn">
                        {t.ecarts} écart{t.ecarts > 1 ? "s" : ""}
                      </span>
                    ) : null}
                    <Link
                      href={zoneHref(t.zone, date)}
                      className="stock-zone-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Ouvrir la fiche →
                    </Link>
                  </div>
                </button>
              ))}
            </div>

            <div
              className="section-tabs"
              role="tablist"
              aria-label="Filtrer par zone"
            >
              <button
                type="button"
                role="tab"
                aria-selected={zoneFilter === "all"}
                className={`section-tab${zoneFilter === "all" ? " is-active" : ""}`}
                onClick={() => setZoneFilter("all")}
              >
                Toutes les zones
              </button>
              {zoneOptions.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={zoneFilter === key}
                  className={`section-tab${zoneFilter === key ? " is-active" : ""}`}
                  onClick={() => setZoneFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {groups.length === 0 ? (
              <p className="muted">
                Aucun stock reporté pour cette date
                {zoneFilter !== "all" ? " dans cette zone" : ""}. Ouvrez la fiche
                du site ou choisissez une date après inventaire.
              </p>
            ) : (
              groups.map((g) => {
                const total = data.totalsByZone.find((t) => t.zone === g.zone);
                const single = zoneFilter !== "all";
                return (
                  <section key={g.zone} className="panel panel-wide stock-zone-panel">
                    <div className="stock-zone-head">
                      <div>
                        <h2 className="panel-title">
                          <Link
                            href={zoneHref(g.zone, date)}
                            className="stock-zone-link"
                          >
                            {g.label}
                          </Link>
                        </h2>
                        <p className="muted stock-zone-hint">
                          {g.rows.length} produit{g.rows.length > 1 ? "s" : ""}
                          {total
                            ? ` · stock final ${total.stockFinal} · vendu ${total.vendu}`
                            : null}
                        </p>
                      </div>
                      {!single ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setZoneFilter(g.zone)}
                        >
                          Filtrer
                        </button>
                      ) : null}
                    </div>
                    {renderTable(g.rows, true)}
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
