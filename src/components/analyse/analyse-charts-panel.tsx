"use client";

import {
  CHART_COLORS,
  DonutChart,
  GroupedBarChart,
  HorizontalBars,
  ProductRanking,
  type ProductRankRow,
} from "@/components/charts/charts";
import { formatFcfa } from "@/lib/format";
import type { AnalyseReport } from "@/lib/analyse-calc";

type KindSlice = {
  key: string;
  label: string;
  value: number;
  color: string;
};

const SHIFT_COLORS: Record<string, string> = {
  jour: CHART_COLORS.plats,
  soir: CHART_COLORS.accent,
  nuit: CHART_COLORS.extra,
  aucune: CHART_COLORS.accompagnements,
};

function toRankRow(p: {
  productId: string;
  name: string;
  kind: string;
  qty: number;
  caNet: number;
}): ProductRankRow {
  return {
    productId: p.productId,
    name: p.name,
    kind: p.kind,
    qty: p.qty,
    ca: p.caNet,
  };
}

type Props = {
  report: AnalyseReport;
  kindSlices: KindSlice[];
};

export function AnalyseChartsPanel({ report, kindSlices }: Props) {
  const mixTotal = kindSlices.reduce((s, x) => s + Math.max(0, x.value), 0);

  const ranked = [...report.products].sort((a, b) => b.caNet - a.caNet);
  const best = ranked.slice(0, 8).map(toRankRow);
  const worst = [...ranked]
    .reverse()
    .filter((p) => p.caNet > 0)
    .slice(0, 8)
    .map(toRankRow);

  return (
    <div className="analyse-charts-dashboard">
      <section className="panel dash-card dash-card-wide analyse-charts-main">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Cette période vs précédente</h2>
            <p className="muted">
              {report.window.label} · {report.window.previousLabel}
            </p>
          </div>
        </div>
        <GroupedBarChart
          height={280}
          labels={["CA net", "CMV", "Charges", "Résultat"]}
          series={[
            {
              key: "prev",
              label: report.window.previousLabel,
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
              label: report.window.label,
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

      <section className="panel dash-card dash-card-wide analyse-mix-panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Mix des ventes</h2>
            <p className="muted">Répartition du CA net par nature</p>
          </div>
        </div>
        {kindSlices.length && mixTotal > 0 ? (
          <div className="analyse-mix-body">
            <DonutChart
              slices={kindSlices}
              centerLabel="CA net"
              centerValue={formatFcfa(mixTotal)}
            />
            <ul className="analyse-mix-legend">
              {kindSlices.map((s) => {
                const share =
                  mixTotal > 0 ? Math.round((s.value / mixTotal) * 100) : 0;
                return (
                  <li key={s.key}>
                    <span
                      className="analyse-mix-swatch"
                      style={{ background: s.color }}
                    />
                    <div className="analyse-mix-copy">
                      <strong>{s.label}</strong>
                      <span className="muted">{share} % du CA</span>
                    </div>
                    <span className="mono">{formatFcfa(s.value)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="muted">Pas de ventes sur la période.</p>
        )}
      </section>

      <div className="dash-grid">
        <section className="panel dash-card">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Par site</h2>
              <p className="muted">Part du CA net</p>
            </div>
          </div>
          {report.bySite.length ? (
            <HorizontalBars
              rows={report.bySite.map((r, i) => ({
                key: r.key,
                label: `${r.label} · ${r.sharePct.toFixed(0)} %`,
                value: r.caNet,
                color: i === 0 ? CHART_COLORS.zogbo : CHART_COLORS.gbegamey,
              }))}
            />
          ) : (
            <p className="muted">Aucune vente ventilée par site.</p>
          )}
        </section>
        <section className="panel dash-card">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Par équipe</h2>
              <p className="muted">Part du CA net</p>
            </div>
          </div>
          {report.byShift.length ? (
            <HorizontalBars
              rows={report.byShift.map((r) => ({
                key: r.key,
                label: `${r.label} · ${r.sharePct.toFixed(0)} %`,
                value: r.caNet,
                color: SHIFT_COLORS[r.key] ?? CHART_COLORS.plats,
              }))}
            />
          ) : (
            <p className="muted">Aucune vente ventilée par équipe.</p>
          )}
        </section>
      </div>

      <section className="panel dash-card dash-card-wide">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Classement produits</h2>
            <p className="muted">Meilleurs et plus faibles CA de la période</p>
          </div>
        </div>
        {best.length ? (
          <ProductRanking best={best} worst={worst} />
        ) : (
          <p className="muted">Aucune vente active sur la période.</p>
        )}
      </section>
    </div>
  );
}
