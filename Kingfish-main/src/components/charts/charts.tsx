"use client";

import { useMemo, useState } from "react";
import { formatFcfa, formatFcfaCompact } from "@/lib/format";

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  values: number[];
};

export type ProductRankRow = {
  productId: string;
  name: string;
  kind: string;
  qty: number;
  ca: number;
};

function niceMax(values: number[]): number {
  const m = Math.max(0, ...values);
  if (m === 0) return 1000;
  const pow = 10 ** Math.floor(Math.log10(m));
  return Math.ceil(m / pow) * pow;
}

function shortKind(kind: string): string {
  switch (kind) {
    case "plat":
      return "Plat";
    case "local":
      return "Accomp.";
    case "boisson":
      return "Boisson";
    case "extra":
      return "Extra";
    default:
      return kind;
  }
}

type RankPairRows = {
  best: ProductRankRow[];
  worst: ProductRankRow[];
};

function RankList({
  rows,
  mode,
  empty,
}: {
  rows: ProductRankRow[];
  mode: "best" | "worst";
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.ca));
  if (!rows.length) return <p className="muted rank-empty">{empty}</p>;
  return (
    <ol className="rank-list">
      {rows.map((row, i) => (
        <li
          key={`${mode}-${row.productId}-${row.kind}-${i}`}
          className="rank-row"
        >
          <span
            className={
              mode === "best"
                ? `rank-medal rank-medal-${Math.min(i + 1, 4)}`
                : "rank-medal rank-medal-low"
            }
          >
            {i + 1}
          </span>
          <div className="rank-body">
            <div className="rank-line">
              <strong className="rank-name" title={row.name}>
                {row.name}
              </strong>
              <span className="mono rank-ca">{formatFcfa(row.ca)}</span>
            </div>
            <div className="rank-line-sub">
              <span className="muted">
                {row.qty} · {shortKind(row.kind)}
              </span>
              <div className="rank-track" aria-hidden>
                <div
                  className={`rank-fill rank-fill-${mode}`}
                  style={{ width: `${(row.ca / max) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function RankSplit({
  best,
  worst,
  bestTitle,
  worstTitle,
}: {
  best: ProductRankRow[];
  worst: ProductRankRow[];
  bestTitle: string;
  worstTitle: string;
}) {
  return (
    <div className="rank-split">
      <section className="rank-col rank-col-best">
        <h3 className="rank-col-title">
          <span className="rank-badge rank-badge-best">Top</span>
          {bestTitle}
        </h3>
        <RankList
          rows={best}
          mode="best"
          empty="Aucune vente dans cette liste."
        />
      </section>
      <section className="rank-col rank-col-worst">
        <h3 className="rank-col-title">
          <span className="rank-badge rank-badge-worst">Bas</span>
          {worstTitle}
        </h3>
        <RankList
          rows={worst}
          mode="worst"
          empty="Pas assez de produits pour un bas de classement."
        />
      </section>
    </div>
  );
}

/** Classement compact : zones côte à côte + produits par catégorie */
export function ProductRanking({
  best,
  worst,
  sites,
  plats,
  accompagnements,
  boissons,
}: {
  best: ProductRankRow[];
  worst: ProductRankRow[];
  sites?: { site: string; label: string; qty: number; ca: number }[];
  plats?: RankPairRows;
  accompagnements?: RankPairRows;
  boissons?: RankPairRows;
}) {
  const siteList = sites ?? [];
  const siteTotal = Math.max(
    1,
    siteList.reduce((s, x) => s + x.ca, 0),
  );
  const siteMax = Math.max(1, ...siteList.map((s) => s.ca));

  const categories = useMemo(() => {
    const list: { id: string; label: string; pair: RankPairRows }[] = [];
    if (plats) list.push({ id: "plats", label: "Plats", pair: plats });
    if (accompagnements) {
      list.push({
        id: "accompagnements",
        label: "Accompagnements",
        pair: accompagnements,
      });
    }
    if (boissons) {
      list.push({ id: "boissons", label: "Boissons", pair: boissons });
    }
    return list;
  }, [plats, accompagnements, boissons]);

  const [tab, setTab] = useState(categories[0]?.id ?? "plats");
  const active =
    categories.find((c) => c.id === tab) ?? categories[0] ?? null;

  return (
    <div className="sales-boards">
      {siteList.length > 0 ? (
        <div className="rank-zones" aria-label="CA par zone">
          {siteList.map((s, i) => {
            const part = Math.round((s.ca / siteTotal) * 100);
            return (
              <article
                key={s.site}
                className={`rank-zone${i === 0 ? " is-leader" : ""}`}
              >
                <header className="rank-zone-head">
                  <span className="rank-zone-pos mono">{i + 1}</span>
                  <div>
                    <strong className="rank-zone-name">{s.label}</strong>
                    <span className="muted">
                      {s.qty} article{s.qty > 1 ? "s" : ""}
                    </span>
                  </div>
                  <strong className="mono rank-zone-ca">
                    {formatFcfa(s.ca)}
                  </strong>
                </header>
                <div className="rank-track" aria-hidden>
                  <div
                    className="rank-fill rank-fill-best"
                    style={{ width: `${(s.ca / siteMax) * 100}%` }}
                  />
                </div>
                <span className="muted rank-zone-part">{part} % du CA</span>
              </article>
            );
          })}
        </div>
      ) : null}

      {active ? (
        <div className="rank-cats">
          <div className="rank-cat-tabs" role="tablist" aria-label="Catégorie">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={active.id === c.id}
                className={`rank-cat-tab${active.id === c.id ? " is-active" : ""}`}
                onClick={() => setTab(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <RankSplit
            best={active.pair.best}
            worst={active.pair.worst}
            bestTitle="Plus vendus"
            worstTitle="Moins vendus"
          />
        </div>
      ) : (
        <RankSplit
          best={best}
          worst={worst}
          bestTitle="Meilleurs produits"
          worstTitle="Moins bons produits"
        />
      )}
    </div>
  );
}

function axisLabel(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (Math.abs(n) >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** Barre verticale à coins hauts arrondis (bas carré). */
function roundedTopBar(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  if (rr <= 0) {
    return `M ${x} ${y + h} V ${y} H ${x + w} V ${y + h} Z`;
  }
  return [
    `M ${x} ${y + h}`,
    `V ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    `H ${x + w - rr}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `V ${y + h}`,
    "Z",
  ].join(" ");
}

/** Courbe moderne : aire douce, trait fin, grille minimale */
export function LineAreaChart({
  labels,
  series,
  height = 280,
}: {
  labels: string[];
  series: ChartSeries[];
  height?: number;
}) {
  const width = 720;
  const pad = { t: 16, r: 16, b: 36, l: 48 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = niceMax(series.flatMap((s) => s.values));
  const n = Math.max(labels.length, 1);
  const xAt = (i: number) =>
    pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad.t + innerH - (v / max) * innerH;
  const showDots = n <= 14;

  function pathFor(values: number[], close: boolean) {
    if (!values.length) return "";
    const pts = values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
    let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1]!;
      const p1 = pts[i]!;
      const cx = (p0.x + p1.x) / 2;
      d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    if (!close) return d;
    return `${d} L ${pts[pts.length - 1]!.x} ${pad.t + innerH} L ${pts[0]!.x} ${pad.t + innerH} Z`;
  }

  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  const uid = `la-${series.map((s) => s.key).join("-")}`;
  const labelStep = Math.max(1, Math.ceil(n / 8));

  return (
    <div className="chart-wrap chart-modern">
      <ul className="chart-legend chart-legend-pills">
        {series.map((s) => (
          <li key={s.key}>
            <span
              className="chart-swatch chart-swatch-line"
              style={{ background: s.color }}
            />
            {s.label}
          </li>
        ))}
      </ul>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Courbe d’évolution"
      >
        <defs>
          {series.map((s) => (
            <linearGradient
              key={s.key}
              id={`${uid}-fill-${s.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
              <stop offset="70%" stopColor={s.color} stopOpacity={0.06} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <line
          x1={pad.l}
          x2={width - pad.r}
          y1={pad.t + innerH}
          y2={pad.t + innerH}
          className="chart-baseline"
        />
        {ticks.map((t) => (
          <g key={t}>
            {t > 0 ? (
              <line
                x1={pad.l}
                x2={width - pad.r}
                y1={yAt(t)}
                y2={yAt(t)}
                className="chart-grid"
              />
            ) : null}
            <text
              x={pad.l - 8}
              y={yAt(t) + 3.5}
              className="chart-axis"
              textAnchor="end"
            >
              {axisLabel(t)}
            </text>
          </g>
        ))}
        {series.map((s, si) => (
          <g key={s.key}>
            {si === 0 ? (
              <path
                d={pathFor(s.values, true)}
                fill={`url(#${uid}-fill-${s.key})`}
              />
            ) : null}
            <path
              d={pathFor(s.values, false)}
              fill="none"
              stroke={s.color}
              strokeWidth={si === 0 ? 2.5 : 2}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={si === 0 ? 1 : 0.85}
            />
            {showDots
              ? s.values.map((v, i) =>
                  v > 0 ? (
                    <circle
                      key={`${s.key}-${i}`}
                      className="chart-dot"
                      cx={xAt(i)}
                      cy={yAt(v)}
                      r={3}
                      fill="#fff"
                      stroke={s.color}
                      strokeWidth={2}
                    >
                      <title>
                        {labels[i]} · {s.label} · {formatFcfa(v)}
                      </title>
                    </circle>
                  ) : null,
                )
              : null}
          </g>
        ))}
        {labels.map((lab, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text
              key={lab + i}
              x={xAt(i)}
              y={height - 10}
              className="chart-axis"
              textAnchor="middle"
            >
              {lab}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

/** Histogramme moderne : barres fines, sommet arrondi */
export function GroupedBarChart({
  labels,
  series,
  height = 260,
}: {
  labels: string[];
  series: ChartSeries[];
  height?: number;
}) {
  const width = 720;
  const pad = { t: 14, r: 12, b: 38, l: 48 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = niceMax(series.flatMap((s) => s.values));
  const groups = Math.max(labels.length, 1);
  const groupW = innerW / groups;
  const barGap = 3;
  const outerPad = Math.min(10, groupW * 0.18);
  const barW = Math.max(
    5,
    (groupW - outerPad * 2 - barGap * (series.length - 1)) / series.length,
  );
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  const uid = `gb-${series.map((s) => s.key).join("-")}`;
  const labelStep = Math.max(1, Math.ceil(groups / 7));

  return (
    <div className="chart-wrap chart-modern">
      <ul className="chart-legend chart-legend-pills">
        {series.map((s) => (
          <li key={s.key}>
            <span
              className="chart-swatch chart-swatch-round"
              style={{ background: s.color }}
            />
            {s.label}
          </li>
        ))}
      </ul>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Histogramme comparatif"
      >
        <defs>
          {series.map((s) => (
            <linearGradient
              key={s.key}
              id={`${uid}-bar-${s.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity={1} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.78} />
            </linearGradient>
          ))}
        </defs>
        <line
          x1={pad.l}
          x2={width - pad.r}
          y1={pad.t + innerH}
          y2={pad.t + innerH}
          className="chart-baseline"
        />
        {ticks.map((t) => (
          <g key={t}>
            {t > 0 ? (
              <line
                x1={pad.l}
                x2={width - pad.r}
                y1={pad.t + innerH - (t / max) * innerH}
                y2={pad.t + innerH - (t / max) * innerH}
                className="chart-grid"
              />
            ) : null}
            <text
              x={pad.l - 8}
              y={pad.t + innerH - (t / max) * innerH + 3.5}
              className="chart-axis"
              textAnchor="end"
            >
              {axisLabel(t)}
            </text>
          </g>
        ))}
        {labels.map((lab, i) => {
          const gx = pad.l + i * groupW + outerPad;
          const clusterW = series.length * barW + (series.length - 1) * barGap;
          return (
            <g key={lab + i}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const h = Math.max(0, (v / max) * innerH);
                const x = gx + si * (barW + barGap);
                const y = pad.t + innerH - h;
                const d = roundedTopBar(
                  x,
                  y,
                  barW,
                  h,
                  Math.min(7, barW / 2),
                );
                if (!d) return null;
                return (
                  <path
                    key={s.key}
                    d={d}
                    fill={`url(#${uid}-bar-${s.key})`}
                    className="chart-bar"
                  >
                    <title>
                      {lab} · {s.label} · {formatFcfa(v)}
                    </title>
                  </path>
                );
              })}
              {(i % labelStep === 0 || i === groups - 1) && (
                <text
                  x={gx + clusterW / 2}
                  y={height - 12}
                  className="chart-axis"
                  textAnchor="middle"
                >
                  {lab}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Anneau fin, centre net, légende avec part */
export function DonutChart({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: { key: string; label: string; value: number; color: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const r = 78;
  const stroke = 18;
  const ringSlices = slices.filter((s) => s.value > 0);
  const totalValue = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const total = totalValue || 1;
  const circ = 2 * Math.PI * r;
  const gap = ringSlices.length > 1 ? 4 : 0;
  let offset = 0;
  const compactCenter = formatFcfaCompact(totalValue);
  const fullCenter = centerValue || formatFcfa(totalValue);
  const showFullDetail = Math.abs(totalValue) >= 10_000;

  return (
    <div className="chart-donut">
      <div className="chart-donut-ring">
        <svg
          className="chart-svg chart-donut-svg"
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label="Répartition"
        >
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            className="chart-donut-track"
            strokeWidth={stroke}
          />
          {ringSlices.map((sl) => {
            const raw = (Math.max(0, sl.value) / total) * circ;
            const len = Math.max(0, raw - gap);
            const el = (
              <circle
                key={sl.key}
                className="chart-donut-seg"
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={sl.color}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${cx} ${cy})`}
              >
                <title>
                  {sl.label} · {formatFcfa(sl.value)} (
                  {Math.round((sl.value / total) * 100)}%)
                </title>
              </circle>
            );
            offset += raw;
            return el;
          })}
        </svg>
        <div className="chart-donut-center">
          <strong className="chart-donut-center-value mono">
            {compactCenter}
          </strong>
          <span className="chart-donut-center-label">{centerLabel}</span>
          {showFullDetail ? (
            <span className="chart-donut-center-full muted mono">
              {fullCenter}
            </span>
          ) : null}
        </div>
      </div>
      <ul className="chart-legend chart-legend-stack">
        {slices.map((sl) => {
          const pct = totalValue
            ? Math.round((Math.max(0, sl.value) / total) * 100)
            : 0;
          return (
            <li key={sl.key}>
              <span
                className="chart-swatch chart-swatch-round"
                style={{ background: sl.color }}
              />
              <span className="chart-legend-label">
                {sl.label}
                <em>{pct}%</em>
              </span>
              <strong className="mono">{formatFcfa(sl.value)}</strong>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function HorizontalBars({
  rows,
}: {
  rows: { key: string; label: string; value: number; color: string }[];
}) {
  const max = niceMax(rows.map((r) => r.value));
  return (
    <ul className="hbar-list">
      {rows.map((r) => {
        const pct = max ? (r.value / max) * 100 : 0;
        return (
          <li key={r.key}>
            <div className="hbar-meta">
              <span>{r.label}</span>
              <strong className="mono">{formatFcfa(r.value)}</strong>
            </div>
            <div className="hbar-track">
              <div
                className="hbar-fill"
                style={{
                  width: `${pct}%`,
                  background: r.color,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export const CHART_COLORS = {
  zogbo: "#005098",
  gbegamey: "#e67e22",
  boissons: "#2a7ec8",
  charges: "#e11d48",
  resultat: "#0f766e",
  plats: "#003d82",
  accompagnements: "#5b8fbf",
  accent: "#f0b018",
  extra: "#7c5cbf",
  best: "#16a34a",
  worst: "#e11d48",
};
