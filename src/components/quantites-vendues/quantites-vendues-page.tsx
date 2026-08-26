"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ExportExcelButton } from "@/components/export-excel-button";
import { formatFcfa } from "@/lib/format";
import { exportQuantitesVenduesExcel } from "@/lib/page-exports";
import type { QuantiteVendueRow, QuantitesVenduesPayload } from "@/lib/quantites-vendues-repo";
import type { VenteKind, VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

type SiteFilter = "all" | VenteSite;
type KindFilter = "all" | VenteKind;

const KIND_LABELS: Record<VenteKind, string> = {
  plat: "Plat",
  local: "Accompagnement",
  boisson: "Boisson",
  combo: "Combo",
  extra: "Extra",
};

function monthStart(d = todayIsoDate()) {
  return `${d.slice(0, 7)}-01`;
}

const EMPTY: QuantitesVenduesPayload = {
  from: monthStart(),
  to: todayIsoDate(),
  site: "all",
  kind: "all",
  q: "",
  rows: [],
  totals: { articles: 0, qty: 0, amount: 0, lignes: 0 },
};

export function QuantitesVenduesPage() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayIsoDate);
  const [site, setSite] = useState<SiteFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [q, setQ] = useState("");
  const [lockedSite, setLockedSite] = useState(false);
  const [data, setData] = useState<QuantitesVenduesPayload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        from,
        to,
        site,
        kind,
      });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/quantites-vendues?${params}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Chargement impossible");
      setData(body as QuantitesVenduesPayload);
      setLockedSite(Boolean(body.lockedSite));
      if (body.lockedSite && (body.site === "zogbo" || body.site === "gbegamey")) {
        setSite(body.site);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [from, to, site, kind, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data.rows;
  const maxQty = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.qty), 0),
    [rows],
  );

  return (
    <AppShell
      title="Quantités vendues"
      subtitle="Suivi des volumes par article — période, site et famille."
      actions={
        <>
          <ExportExcelButton
            label="Excel"
            disabled={loading || rows.length === 0}
            onExport={() => exportQuantitesVenduesExcel(data)}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void load()}
            disabled={loading}
          >
            Actualiser
          </button>
        </>
      }
    >
      <div className="hist-filters hist-ventes-filters">
        <label className="date-field">
          <span>Du</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="date-field">
          <span>Au</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="date-field">
          <span>Site</span>
          <select
            className="select-input"
            value={site}
            onChange={(e) => setSite(e.target.value as SiteFilter)}
            disabled={lockedSite}
          >
            {!lockedSite ? <option value="all">Tous</option> : null}
            <option value="zogbo">Zogbo</option>
            <option value="gbegamey">Gbégamey</option>
          </select>
        </label>
        <label className="date-field">
          <span>Famille</span>
          <select
            className="select-input"
            value={kind}
            onChange={(e) => setKind(e.target.value as KindFilter)}
          >
            <option value="all">Toutes</option>
            <option value="plat">Plats</option>
            <option value="local">Accompagnements</option>
            <option value="boisson">Boissons</option>
            <option value="extra">Extras</option>
          </select>
        </label>
        <label className="date-field">
          <span>Article</span>
          <input
            type="search"
            className="select-input"
            placeholder="Ex. chawarma…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      <div className="qv-summary" role="status">
        <div>
          <span className="qv-summary-label">Articles</span>
          <strong className="mono">{data.totals.articles}</strong>
        </div>
        <div>
          <span className="qv-summary-label">Quantité totale</span>
          <strong className="mono">{data.totals.qty}</strong>
        </div>
        <div>
          <span className="qv-summary-label">CA</span>
          <strong className="mono">{formatFcfa(data.totals.amount)}</strong>
        </div>
        <div>
          <span className="qv-summary-label">Lignes</span>
          <strong className="mono">{data.totals.lignes}</strong>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <BrandLoader label="Chargement des ventes…" />
      ) : rows.length === 0 ? (
        <p className="ui-info">Aucun article vendu sur cette période.</p>
      ) : (
        <div className="table-wrap qv-table-wrap">
          <table className="data-table qv-table">
            <thead>
              <tr>
                <th>Article</th>
                <th>Famille</th>
                <th className="col-num">Qté</th>
                <th className="col-bar" aria-label="Volume relatif" />
                {!lockedSite && site === "all" ? (
                  <>
                    <th className="col-num">Zogbo</th>
                    <th className="col-num">Gbégamey</th>
                  </>
                ) : null}
                <th className="col-money">CA</th>
                <th>Période</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ArticleRow
                  key={`${row.productId}|${row.kind}`}
                  row={row}
                  maxQty={maxQty}
                  showSites={!lockedSite && site === "all"}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

function ArticleRow({
  row,
  maxQty,
  showSites,
}: {
  row: QuantiteVendueRow;
  maxQty: number;
  showSites: boolean;
}) {
  const pct = maxQty > 0 ? Math.round((row.qty / maxQty) * 100) : 0;
  return (
    <tr>
      <td>
        <strong>{row.name}</strong>
      </td>
      <td>{KIND_LABELS[row.kind] ?? row.kind}</td>
      <td className="col-num mono">{row.qty}</td>
      <td className="col-bar">
        <span className="qv-bar" style={{ width: `${pct}%` }} />
      </td>
      {showSites ? (
        <>
          <td className="col-num mono">{row.bySite.zogbo ?? 0}</td>
          <td className="col-num mono">{row.bySite.gbegamey ?? 0}</td>
        </>
      ) : null}
      <td className="col-money mono">{formatFcfa(row.amount)}</td>
      <td className="qv-period">
        {row.firstDate === row.lastDate
          ? row.firstDate
          : `${row.firstDate} → ${row.lastDate}`}
      </td>
    </tr>
  );
}
