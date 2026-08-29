"use client";

import {
  CHART_COLORS,
  DonutChart,
  GroupedBarChart,
  HorizontalBars,
} from "@/components/charts/charts";
import { formatFcfa } from "@/lib/format";
import type { AnalyseReport } from "@/lib/analyse-calc";

type KindSlice = {
  key: string;
  label: string;
  value: number;
  color: string;
};

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "n.d.";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)} %`;
}

function deltaClass(n: number | null | undefined): string {
  if (n === null || n === undefined || n === 0) return "";
  return n > 0 ? "is-up" : "is-down";
}

function CompareKpi({
  label,
  current,
  previous,
  changePct,
  invertTone,
}: {
  label: string;
  current: number;
  previous: number;
  changePct: number | null;
  invertTone?: boolean;
}) {
  const up = (changePct ?? 0) > 0;
  const down = (changePct ?? 0) < 0;
  const good = invertTone ? down : up;
  const bad = invertTone ? up : down;
  const tone =
    changePct === null || changePct === 0
      ? ""
      : good
        ? "is-up"
        : bad
          ? "is-down"
          : "";

  return (
    <article className={`analyse-compare-kpi ${tone}`}>
      <span className="analyse-compare-kpi-label">{label}</span>
      <strong className="analyse-compare-kpi-value mono">{formatFcfa(current)}</strong>
      <span className="analyse-compare-kpi-prev muted">
        {formatFcfa(previous)} · période préc.
      </span>
      <span className={`analyse-compare-kpi-delta ${deltaClass(changePct)}`}>
        {fmtPct(changePct)}
      </span>
    </article>
  );
}

type Props = {
  report: AnalyseReport;
  kindSlices: KindSlice[];
};

export function AnalyseChartsPanel({ report, kindSlices }: Props) {
  const topProducts = [...report.products]
    .sort((a, b) => b.caNet - a.caNet)
    .slice(0, 8);

  const productBars = topProducts.map((p) => ({
    key: `${p.kind}:${p.productId}`,
    label: p.name,
    value: p.caNet,
    color:
      p.kind === "plat"
        ? CHART_COLORS.plats
        : p.kind === "boisson"
          ? CHART_COLORS.boissons
          : p.kind === "local"
            ? CHART_COLORS.accompagnements
            : CHART_COLORS.extra,
  }));

  return (
    <div className="analyse-charts-dashboard">
      <section
        className="analyse-compare-kpis"
        aria-label="Évolution des indicateurs clés"
      >
        <CompareKpi
          label="CA net"
          current={report.current.caNet}
          previous={report.previous.caNet}
          changePct={report.caChangePct}
        />
        <CompareKpi
          label="CMV"
          current={report.current.cmv}
          previous={report.previous.cmv}
          changePct={report.cmvChangePct}
          invertTone
        />
        <CompareKpi
          label="Charges"
          current={report.current.chargesExploitation}
          previous={report.previous.chargesExploitation}
          changePct={report.chargesChangePct}
          invertTone
        />
        <CompareKpi
          label="Résultat"
          current={report.current.resultat}
          previous={report.previous.resultat}
          changePct={report.resultatChangePct}
        />
      </section>

      <section className="panel analyse-charts-main">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Comparaison financière</h2>
            <p className="muted">
              {report.window.label} vs {report.window.previousLabel}
            </p>
          </div>
        </div>
        <GroupedBarChart
          height={300}
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

      <div className="analyse-charts-split">
        <section className="panel analyse-charts-mix">
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

        <section className="panel">
          <h2 className="panel-title">Par site</h2>
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

        <section className="panel">
          <h2 className="panel-title">Par équipe</h2>
          {report.byShift.length ? (
            <HorizontalBars
              rows={report.byShift.map((r) => ({
                key: r.key,
                label: `${r.label} · ${r.sharePct.toFixed(0)} %`,
                value: r.caNet,
                color: CHART_COLORS.plats,
              }))}
            />
          ) : (
            <p className="muted">Aucune vente ventilée par équipe.</p>
          )}
        </section>
      </div>

      <section className="panel panel-wide">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Top produits</h2>
            <p className="muted">Classement par CA net sur la période</p>
          </div>
        </div>
        {productBars.length ? (
          <HorizontalBars rows={productBars} />
        ) : (
          <p className="muted">Aucune vente active sur la période.</p>
        )}
      </section>
    </div>
  );
}
