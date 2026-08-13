"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import { formatFcfa } from "@/lib/format";
import { exportEquipesExcel } from "@/lib/page-exports";
import type { ShiftDayRow } from "@/lib/vente-repo";
import { formatDisplayDate, shiftIsoDate, todayIsoDate } from "@/lib/zogbo-calc";
import { BrandLoader } from "@/components/brand-loader";

type SiteFilter = "all" | "zogbo" | "gbegamey";

type EquipesResponse = {
  from: string;
  to: string;
  site: SiteFilter;
  lockedSite: boolean;
  days: ShiftDayRow[];
  totals: { jour: number; nuit: number; aucune: number; total: number };
};

function monthStartIso(d = todayIsoDate()): string {
  return `${d.slice(0, 7)}-01`;
}

/** Lundi de la semaine contenant `d`. */
function weekStartIso(d = todayIsoDate()): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(y, m - 1, day);
  const dow = dt.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  return shiftIsoDate(d, diff) ?? d;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 100)} %`;
}

function siteLabel(site: SiteFilter): string {
  if (site === "zogbo") return "Zogbo";
  if (site === "gbegamey") return "Gbégamey";
  return "Tous les sites";
}

export function EquipesPage() {
  const [from, setFrom] = useState(() => monthStartIso());
  const [to, setTo] = useState(() => todayIsoDate());
  const [site, setSite] = useState<SiteFilter>("all");
  const [lockedSite, setLockedSite] = useState(false);
  const [data, setData] = useState<EquipesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, site });
      const res = await fetch(`/api/equipes?${params}`, { cache: "no-store" });
      const body = (await res.json()) as EquipesResponse & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setData(body);
      if (body.lockedSite && body.site && body.site !== "all") {
        setLockedSite(true);
        setSite(body.site);
      } else if (typeof body.lockedSite === "boolean") {
        setLockedSite(!!body.lockedSite);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, site]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeDays = useMemo(
    () => (data?.days ?? []).filter((d) => d.total > 0),
    [data?.days],
  );

  const totals = data?.totals ?? { jour: 0, nuit: 0, aucune: 0, total: 0 };

  function applyPreset(preset: "month" | "week" | "lastWeek") {
    const today = todayIsoDate();
    if (preset === "month") {
      setFrom(monthStartIso(today));
      setTo(today);
      return;
    }
    const monday = weekStartIso(today);
    if (preset === "week") {
      setFrom(monday);
      setTo(today);
      return;
    }
    const lastMonday = shiftIsoDate(monday, -7) ?? monday;
    const lastSunday = shiftIsoDate(monday, -1) ?? monday;
    setFrom(lastMonday);
    setTo(lastSunday);
  }

  return (
    <AppShell
      title="Répartition équipes"
      subtitle="CA jour contre nuit sur une période — même source que l’écran Vente."
      actions={
        <>
          <ExportExcelButton
            onExport={() =>
              data
                ? exportEquipesExcel({
                    from: data.from,
                    to: data.to,
                    site: data.site,
                    days: data.days,
                    totals: data.totals,
                  })
                : Promise.resolve()
            }
            disabled={loading || !data || activeDays.length === 0}
          />
          <Link href="/vente" className="btn btn-ghost">
            ← Vente
          </Link>
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
        <div className="date-field equipes-presets">
          <span>Période</span>
          <div className="equipes-preset-btns">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => applyPreset("week")}
            >
              Cette semaine
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => applyPreset("lastWeek")}
            >
              Semaine dernière
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => applyPreset("month")}
            >
              Ce mois
            </button>
          </div>
        </div>
      </div>

      <div className="dash-ca-final hist-ventes-totaux">
        <div className="dash-ca-final-main">
          <span className="dash-ca-final-label">CA période</span>
          <strong className="dash-ca-final-value mono">
            {formatFcfa(totals.total)}
          </strong>
          <span className="dash-ca-final-hint">
            {siteLabel(site)} · {formatDisplayDate(from)} →{" "}
            {formatDisplayDate(to)} · {activeDays.length} jour
            {activeDays.length > 1 ? "s" : ""} avec ventes
          </span>
        </div>
        <div className="dash-ca-final-side">
          <div>
            <span>Équipe jour</span>
            <strong className="mono">{formatFcfa(totals.jour)}</strong>
            <span className="equipes-pct">{pct(totals.jour, totals.total)}</span>
          </div>
          <div>
            <span>Équipe nuit</span>
            <strong className="mono">{formatFcfa(totals.nuit)}</strong>
            <span className="equipes-pct">{pct(totals.nuit, totals.total)}</span>
          </div>
          {totals.aucune > 0 ? (
            <div>
              <span>Hors équipe</span>
              <strong className="mono">{formatFcfa(totals.aucune)}</strong>
              <span className="equipes-pct">
                {pct(totals.aucune, totals.total)}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <BrandLoader variant="ligne" label="Chargement des équipes…" />
      ) : (
        <section className="panel">
          <h2 className="panel-title">Détail jour par jour</h2>
          <table className="data-table zogbo-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" className="col-money">
                  Jour
                </th>
                <th scope="col" className="col-money">
                  Nuit
                </th>
                {totals.aucune > 0 ? (
                  <th scope="col" className="col-money">
                    Hors équipe
                  </th>
                ) : null}
                <th scope="col" className="col-money">
                  Total
                </th>
                <th scope="col" className="col-money">
                  % jour
                </th>
                <th scope="col" className="col-money">
                  % nuit
                </th>
              </tr>
            </thead>
            <tbody>
              {(data?.days ?? []).map((d) => {
                const active = d.total > 0;
                return (
                  <tr key={d.date} className={active ? undefined : "row-muted"}>
                    <td className="cell-name">{formatDisplayDate(d.date)}</td>
                    <td className="mono cell-readonly">
                      {active ? formatFcfa(d.jour) : "—"}
                    </td>
                    <td className="mono cell-readonly">
                      {active ? formatFcfa(d.nuit) : "—"}
                    </td>
                    {totals.aucune > 0 ? (
                      <td className="mono cell-readonly">
                        {active ? formatFcfa(d.aucune) : "—"}
                      </td>
                    ) : null}
                    <td className="mono cell-readonly">
                      {active ? formatFcfa(d.total) : "—"}
                    </td>
                    <td className="mono cell-readonly">
                      {active ? pct(d.jour, d.total) : "—"}
                    </td>
                    <td className="mono cell-readonly">
                      {active ? pct(d.nuit, d.total) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="cell-name">Total période</td>
                <td className="mono cell-readonly">{formatFcfa(totals.jour)}</td>
                <td className="mono cell-readonly">{formatFcfa(totals.nuit)}</td>
                {totals.aucune > 0 ? (
                  <td className="mono cell-readonly">
                    {formatFcfa(totals.aucune)}
                  </td>
                ) : null}
                <td className="mono cell-readonly">{formatFcfa(totals.total)}</td>
                <td className="mono cell-readonly">
                  {pct(totals.jour, totals.total)}
                </td>
                <td className="mono cell-readonly">
                  {pct(totals.nuit, totals.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}
    </AppShell>
  );
}
