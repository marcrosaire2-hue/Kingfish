"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ContextBar } from "@/components/context-bar";
import {
  CHART_COLORS,
  DonutChart,
  GroupedBarChart,
  HorizontalBars,
} from "@/components/charts/charts";
import { formatFcfa } from "@/lib/format";
import { SITE_LABELS } from "@/lib/auth-types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import type {
  AnalysePeriod,
  AnalyseReport,
  HealthTone,
  Insight,
  InsightKind,
  ProductAdvice,
} from "@/lib/analyse-calc";

type Payload = {
  report: AnalyseReport;
  lockedSite: boolean;
  userSite: string;
};

const PERIODS: { id: AnalysePeriod; label: string }[] = [
  { id: "day", label: "Jour" },
  { id: "week", label: "Semaine" },
  { id: "month", label: "Mois" },
];

function toneClass(tone: HealthTone | Insight["tone"]): string {
  if (tone === "ok") return "is-ok";
  if (tone === "risque") return "is-risk";
  if (tone === "attention") return "is-watch";
  return "is-mute";
}

function kindBadge(kind: InsightKind): string {
  if (kind === "fait") return "Fait";
  if (kind === "estimation") return "Estimation";
  if (kind === "alerte") return "Alerte";
  return "Conseil";
}

function adviceClass(advice: ProductAdvice): string {
  if (advice === "À développer") return "is-ok";
  if (advice === "À surveiller" || advice === "À optimiser") return "is-watch";
  if (advice === "À revoir") return "is-risk";
  return "is-mute";
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "n.d.";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)} %`;
}

function InsightCard({ item }: { item: Insight }) {
  return (
    <article className={`analyse-insight ${toneClass(item.tone)}`}>
      <header>
        <span className="analyse-badge">{kindBadge(item.kind)}</span>
        <h3>{item.title}</h3>
      </header>
      <p>{item.body}</p>
      {item.action ? (
        <p className="analyse-insight-action">
          <span>À faire</span> {item.action}
        </p>
      ) : null}
      <footer>
        {item.metric ? <span className="mono">{item.metric}</span> : <span />}
        <span>Confiance {item.confidence}</span>
      </footer>
    </article>
  );
}

export function AnalysePage() {
  const [period, setPeriod] = useState<AnalysePeriod>("month");
  const [date, setDate] = useState(todayIsoDate);
  const [site, setSite] = useState("zogbo");
  const [shift, setShift] = useState("all");
  const [kind, setKind] = useState("all");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ period, date, site, shift, kind });
      const res = await fetch(`/api/analyse?${qs}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Chargement impossible");
      setPayload(body as Payload);
    } catch (e) {
      setPayload(null);
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setLoading(false);
    }
  }, [period, date, site, shift, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const report = payload?.report;
  const lockedSite = payload?.lockedSite ?? false;

  const kindSlices = useMemo(() => {
    if (!report) return [];
    const colors: Record<string, string> = {
      plat: CHART_COLORS.plats,
      boisson: CHART_COLORS.boissons,
      local: CHART_COLORS.accompagnements,
      extra: CHART_COLORS.extra,
    };
    return report.byKind.map((row) => ({
      key: row.key,
      label: row.label,
      value: row.caNet,
      color: colors[row.key] ?? CHART_COLORS.accent,
    }));
  }, [report]);

  if (loading && !report) {
    return (
      <AppShell
        title="Analyse"
        subtitle="Lecture managériale du CA, des marges et des charges."
      >
        <BrandLoader variant="ligne" label="Analyse des données…" />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Analyse"
      subtitle="Lecture managériale du CA, des marges, des stocks et des charges — sans réécrire la comptabilité."
    >
      <div className="section-tabs" role="tablist" aria-label="Période">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={period === p.id}
            className={`section-tab${period === p.id ? " is-active" : ""}`}
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <ContextBar date={date} onDateChange={setDate}>
        {lockedSite ? null : (
          <label className="date-field date-field-pill">
            <span>Site</span>
            <select value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="zogbo">{SITE_LABELS.zogbo}</option>
              <option value="gbegamey">{SITE_LABELS.gbegamey}</option>
            </select>
          </label>
        )}
        <label className="date-field date-field-pill">
          <span>Équipe</span>
          <select value={shift} onChange={(e) => setShift(e.target.value)}>
            <option value="all">Toutes</option>
            <option value="jour">Jour</option>
            <option value="nuit">Nuit</option>
            <option value="aucune">Hors équipe</option>
          </select>
        </label>
        <label className="date-field date-field-pill">
          <span>Nature</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">Toutes</option>
            <option value="plat">Plats</option>
            <option value="boisson">Boissons</option>
            <option value="local">Accompagnements</option>
            <option value="extra">Extra</option>
          </select>
        </label>
      </ContextBar>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {report ? (
        <div className={`analyse${loading ? " is-loading" : ""}`}>
          <p className="analyse-window muted">
            {report.window.label} · comparé à {report.window.previousLabel}
            {report.filteredCa
              ? " · CA filtré (CMV et charges restent au périmètre maison / site)"
              : ""}
          </p>

          <section className="analyse-health" aria-label="Santé de l’activité">
            {report.health.map((card) => (
              <article
                key={card.key}
                className={`analyse-health-card ${toneClass(card.tone)}`}
              >
                <span className="analyse-health-tone">
                  {card.tone === "ok"
                    ? "Favorable"
                    : card.tone === "risque"
                      ? "Risque"
                      : card.tone === "attention"
                        ? "Vigilance"
                        : "Indéterminé"}
                </span>
                <h2>{card.label}</h2>
                <p>{card.summary}</p>
              </article>
            ))}
          </section>

          <section className="dash-kpi-grid" aria-label="Indicateurs">
            <div className="dash-kpi">
              <span className="dash-kpi-label">CA net</span>
              <span className="dash-kpi-value mono">
                {formatFcfa(report.current.caNet)}
              </span>
              <span className="analyse-delta">{fmtPct(report.caChangePct)}</span>
            </div>
            <div className="dash-kpi dash-kpi-accent">
              <span className="dash-kpi-label">Marge brute (CMV)</span>
              <span className="dash-kpi-value mono">
                {report.current.margeBrute === null
                  ? "n.d."
                  : formatFcfa(report.current.margeBrute)}
              </span>
              <span className="analyse-delta muted">Fait d’exploitation</span>
            </div>
            <div className="dash-kpi">
              <span className="dash-kpi-label">Charges d’exploitation</span>
              <span className="dash-kpi-value mono">
                {formatFcfa(report.current.chargesExploitation)}
              </span>
              <span className="analyse-delta">
                {fmtPct(report.chargesChangePct)}
              </span>
            </div>
            <div className="dash-kpi dash-kpi-warn">
              <span className="dash-kpi-label">Résultat</span>
              <span className="dash-kpi-value mono">
                {formatFcfa(report.current.resultat)}
              </span>
              <span className="analyse-delta">
                {fmtPct(report.resultatChangePct)}
              </span>
            </div>
          </section>

          <div className="dash-grid">
            <section className="panel">
              <h2 className="panel-title">Période vs précédente</h2>
              <GroupedBarChart
                labels={["CA net", "CMV", "Charges", "Résultat"]}
                series={[
                  {
                    key: "prev",
                    label: "Précédente",
                    color: CHART_COLORS.accompagnements,
                    values: [
                      report.previous.caNet,
                      report.previous.cmv,
                      report.previous.chargesExploitation,
                      report.previous.resultat,
                    ],
                  },
                  {
                    key: "cur",
                    label: "Période",
                    color: CHART_COLORS.zogbo,
                    values: [
                      report.current.caNet,
                      report.current.cmv,
                      report.current.chargesExploitation,
                      report.current.resultat,
                    ],
                  },
                ]}
              />
            </section>
            <section className="panel">
              <h2 className="panel-title">Mix par nature</h2>
              {kindSlices.length ? (
                <DonutChart
                  slices={kindSlices}
                  centerLabel="CA net"
                  centerValue={formatFcfa(report.current.caNet)}
                />
              ) : (
                <p className="muted">Pas de ventes sur la période.</p>
              )}
            </section>
          </div>

          <div className="dash-grid">
            <section className="panel">
              <h2 className="panel-title">Sites</h2>
              <HorizontalBars
                rows={report.bySite.map((r, i) => ({
                  key: r.key,
                  label: r.label,
                  value: r.caNet,
                  color: i === 0 ? CHART_COLORS.zogbo : CHART_COLORS.gbegamey,
                }))}
              />
            </section>
            <section className="panel">
              <h2 className="panel-title">Équipes</h2>
              <HorizontalBars
                rows={report.byShift.map((r) => ({
                  key: r.key,
                  label: r.label,
                  value: r.caNet,
                  color: CHART_COLORS.plats,
                }))}
              />
            </section>
          </div>

          <section className="analyse-columns">
            <div>
              <h2 className="panel-title">Ce qui va bien</h2>
              {report.positives.length ? (
                report.positives.map((item) => (
                  <InsightCard key={item.id} item={item} />
                ))
              ) : (
                <p className="muted">Pas de signal positif assez net.</p>
              )}
            </div>
            <div>
              <h2 className="panel-title">À surveiller</h2>
              {report.watches.length ? (
                report.watches.map((item) => (
                  <InsightCard key={item.id} item={item} />
                ))
              ) : (
                <p className="muted">Aucune alerte relative.</p>
              )}
            </div>
            <div>
              <h2 className="panel-title">Conseils</h2>
              {report.conseils.length ? (
                report.conseils.map((item) => (
                  <InsightCard key={item.id} item={item} />
                ))
              ) : (
                <p className="muted">Rien à recommander sans signal mesurable.</p>
              )}
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-title">Produits</h2>
            <div className="table-scroll">
              <table className="data-table analyse-table">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Nature</th>
                    <th className="num">Qté</th>
                    <th className="num">CA net</th>
                    <th className="num">Remise</th>
                    <th className="num">Coût</th>
                    <th className="num">Marge</th>
                    <th className="num">Évolution</th>
                    <th>Conseil</th>
                  </tr>
                </thead>
                <tbody>
                  {report.products.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="muted">
                        Aucune vente active sur la période.
                      </td>
                    </tr>
                  ) : (
                    report.products.map((p) => (
                      <tr key={`${p.kind}:${p.productId}`}>
                        <td>{p.name}</td>
                        <td>{p.kind}</td>
                        <td className="num mono">{p.qty}</td>
                        <td className="num mono">{formatFcfa(p.caNet)}</td>
                        <td className="num mono">{formatFcfa(p.remises)}</td>
                        <td className="num mono">
                          {p.costKnown ? formatFcfa(p.costAmount) : "coût inconnu"}
                        </td>
                        <td className="num mono">
                          {p.marginPct === null ? "—" : `${p.marginPct.toFixed(0)} %`}
                        </td>
                        <td className="num mono">{fmtPct(p.qtyChangePct)}</td>
                        <td>
                          <span className={`analyse-advice ${adviceClass(p.advice)}`}>
                            {p.advice}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel analyse-notes">
            <h2 className="panel-title">Limites de lecture</h2>
            <ul>
              {report.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="muted">
              Achats stock {formatFcfa(report.current.achatsStock)} · acquisitions{" "}
              {formatFcfa(report.current.acquisitionsImmobilisations)} · sorties de
              caisse {formatFcfa(report.current.caisseDepenses)} (hors résultat, M1 /
              G8 / G9).
            </p>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
