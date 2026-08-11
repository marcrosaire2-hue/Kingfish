"use client";

import { formatFcfa } from "@/lib/format";

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
      return "Local";
    case "combo":
      return "Combo";
    case "boisson":
      return "Boisson";
    case "extra":
      return "Extra";
    default:
      return kind;
  }
}

/** Courbe « vague » : dégradés, halo, points lumineux */
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
  const pad = { t: 20, r: 18, b: 40, l: 56 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = niceMax(series.flatMap((s) => s.values));
  const n = Math.max(labels.length, 1);
  const xAt = (i: number) =>
    pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad.t + innerH - (v / max) * innerH;

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

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
  const uid = `la-${series.map((s) => s.key).join("-")}`;

  return (
    <div className="chart-wrap chart-wrap-wave">
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
              <stop offset="0%" stopColor={s.color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
          <filter id={`${uid}-glow`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={yAt(t)}
              y2={yAt(t)}
              className="chart-grid"
            />
            <text x={pad.l - 10} y={yAt(t) + 4} className="chart-axis" textAnchor="end">
              {t >= 1000 ? `${Math.round(t / 1000)}k` : t}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.key}>
            <path
              d={pathFor(s.values, true)}
              fill={`url(#${uid}-fill-${s.key})`}
            />
            <path
              d={pathFor(s.values, false)}
              fill="none"
              stroke={s.color}
              strokeWidth={3.2}
              strokeLinejoin="round"
              strokeLinecap="round"
              filter={`url(#${uid}-glow)`}
            />
            {s.values.map((v, i) =>
              v > 0 ? (
                <g key={`${s.key}-${i}`}>
                  <circle
                    cx={xAt(i)}
                    cy={yAt(v)}
                    r={6}
                    fill={s.color}
                    opacity={0.2}
                  />
                  <circle
                    cx={xAt(i)}
                    cy={yAt(v)}
                    r={3.5}
                    fill="#fff"
                    stroke={s.color}
                    strokeWidth={2.2}
                  >
                    <title>
                      {labels[i]} · {s.label} · {formatFcfa(v)}
                    </title>
                  </circle>
                </g>
              ) : null,
            )}
          </g>
        ))}
        {labels.map((lab, i) =>
          i % Math.ceil(n / 10) === 0 || i === n - 1 ? (
            <text
              key={lab + i}
              x={xAt(i)}
              y={height - 12}
              className="chart-axis"
              textAnchor="middle"
            >
              {lab}
            </text>
          ) : null,
        )}
      </svg>
      <ul className="chart-legend">
        {series.map((s) => (
          <li key={s.key}>
            <span className="chart-swatch" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barres « pastilles » empilées avec coins arrondis et dégradé */
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
  const pad = { t: 18, r: 14, b: 40, l: 56 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = niceMax(series.flatMap((s) => s.values));
  const groups = Math.max(labels.length, 1);
  const groupW = innerW / groups;
  const barGap = 4;
  const barW = Math.max(
    5,
    (groupW - 12 - barGap * (series.length - 1)) / series.length,
  );
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  const uid = `gb-${series.map((s) => s.key).join("-")}`;

  return (
    <div className="chart-wrap chart-wrap-bars">
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
              <stop offset="100%" stopColor={s.color} stopOpacity={0.72} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={pad.t + innerH - (t / max) * innerH}
              y2={pad.t + innerH - (t / max) * innerH}
              className="chart-grid"
            />
            <text
              x={pad.l - 10}
              y={pad.t + innerH - (t / max) * innerH + 4}
              className="chart-axis"
              textAnchor="end"
            >
              {t >= 1000 ? `${Math.round(t / 1000)}k` : t}
            </text>
          </g>
        ))}
        {labels.map((lab, i) => {
          const gx = pad.l + i * groupW + 6;
          return (
            <g key={lab + i}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const h = (v / max) * innerH;
                const x = gx + si * (barW + barGap);
                const y = pad.t + innerH - h;
                return (
                  <rect
                    key={s.key}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(0, h)}
                    rx={Math.min(8, barW / 2)}
                    fill={`url(#${uid}-bar-${s.key})`}
                  >
                    <title>
                      {lab} · {s.label} · {formatFcfa(v)}
                    </title>
                  </rect>
                );
              })}
              {(i % Math.ceil(groups / 10) === 0 || i === groups - 1) && (
                <text
                  x={gx + (series.length * (barW + barGap)) / 2}
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
      <ul className="chart-legend">
        {series.map((s) => (
          <li key={s.key}>
            <span className="chart-swatch" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Anneau segmenté avec écarts et caps arrondis */
export function DonutChart({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: { key: string; label: string; value: number; color: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const r = 82;
  const stroke = 26;
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  const circ = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 6 : 0;
  let offset = 0;

  return (
    <div className="chart-donut">
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
          stroke="var(--line)"
          strokeWidth={stroke}
          opacity={0.28}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r - stroke / 2 - 8}
          fill="var(--paper)"
          opacity={0.55}
        />
        {slices.map((sl) => {
          const raw = (Math.max(0, sl.value) / total) * circ;
          const len = Math.max(0, raw - gap);
          const el = (
            <circle
              key={sl.key}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={sl.color}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
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
        <text x={cx} y={cy - 4} className="chart-donut-value" textAnchor="middle">
          {centerValue}
        </text>
        <text x={cx} y={cy + 18} className="chart-donut-label" textAnchor="middle">
          {centerLabel}
        </text>
      </svg>
      <ul className="chart-legend chart-legend-stack">
        {slices.map((sl) => (
          <li key={sl.key}>
            <span className="chart-swatch chart-swatch-round" style={{ background: sl.color }} />
            <span>{sl.label}</span>
            <strong className="mono">{formatFcfa(sl.value)}</strong>
          </li>
        ))}
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
      {rows.map((r) => (
        <li key={r.key}>
          <div className="hbar-meta">
            <span>{r.label}</span>
            <strong className="mono">{formatFcfa(r.value)}</strong>
          </div>
          <div className="hbar-track">
            <div
              className="hbar-fill"
              style={{
                width: `${max ? (r.value / max) * 100 : 0}%`,
                background: `linear-gradient(90deg, ${r.color}, color-mix(in srgb, ${r.color} 70%, #fff))`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Classement podium meilleurs / moins bons produits */
export function ProductRanking({
  best,
  worst,
}: {
  best: ProductRankRow[];
  worst: ProductRankRow[];
}) {
  const bestMax = Math.max(1, ...best.map((r) => r.ca));
  const worstMax = Math.max(1, ...worst.map((r) => r.ca));

  return (
    <div className="rank-grid">
      <section className="rank-panel rank-panel-best">
        <header className="rank-header">
          <span className="rank-badge rank-badge-best">Top</span>
          <h3 className="rank-title">Meilleurs produits</h3>
          <p className="rank-sub">Classés par CA (FCFA)</p>
        </header>
        {best.length ? (
          <ol className="rank-list">
            {best.map((row, i) => (
              <li key={`best-${row.productId}-${row.kind}`} className="rank-row">
                <span className={`rank-medal rank-medal-${Math.min(i + 1, 4)}`}>
                  {i + 1}
                </span>
                <div className="rank-body">
                  <div className="rank-meta">
                    <strong className="rank-name">{row.name}</strong>
                    <span className="rank-kind">{shortKind(row.kind)}</span>
                  </div>
                  <div className="rank-track">
                    <div
                      className="rank-fill rank-fill-best"
                      style={{ width: `${(row.ca / bestMax) * 100}%` }}
                    />
                  </div>
                  <div className="rank-stats">
                    <span className="mono">{formatFcfa(row.ca)}</span>
                    <span className="muted">{row.qty} vendus</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">Aucune vente sur cette période.</p>
        )}
      </section>

      <section className="rank-panel rank-panel-worst">
        <header className="rank-header">
          <span className="rank-badge rank-badge-worst">Bas</span>
          <h3 className="rank-title">Moins bons produits</h3>
          <p className="rank-sub">Plus faible CA (parmi les vendus)</p>
        </header>
        {worst.length ? (
          <ol className="rank-list">
            {worst.map((row, i) => (
              <li key={`worst-${row.productId}-${row.kind}`} className="rank-row">
                <span className="rank-medal rank-medal-low">{i + 1}</span>
                <div className="rank-body">
                  <div className="rank-meta">
                    <strong className="rank-name">{row.name}</strong>
                    <span className="rank-kind">{shortKind(row.kind)}</span>
                  </div>
                  <div className="rank-track">
                    <div
                      className="rank-fill rank-fill-worst"
                      style={{ width: `${(row.ca / worstMax) * 100}%` }}
                    />
                  </div>
                  <div className="rank-stats">
                    <span className="mono">{formatFcfa(row.ca)}</span>
                    <span className="muted">{row.qty} vendus</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">Pas assez de produits pour un bas de classement.</p>
        )}
      </section>
    </div>
  );
}

export const CHART_COLORS = {
  zogbo: "#005098",
  gbegamey: "#2a7ec8",
  combos: "#f0b018",
  boissons: "#004080",
  charges: "#dc2626",
  resultat: "#004888",
  plats: "#0060b0",
  accent: "#f0b018",
  extra: "#5a7a9a",
  best: "#16a34a",
  worst: "#dc2626",
};
