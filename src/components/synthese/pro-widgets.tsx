"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const nf = new Intl.NumberFormat("fr-FR");

/** Compteur animé : monte de 0 à la valeur (instantané si l'animation est réduite). */
export function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 0 : ms;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

export function CountUp({
  value,
  suffix,
}: {
  value: number;
  suffix?: string;
}) {
  const v = useCountUp(value);
  return (
    <>
      {nf.format(v)}
      {suffix ? <small>{suffix}</small> : null}
    </>
  );
}

export type KpiTone = "blue" | "amber" | "green" | "red" | "violet" | "slate";

export function KpiCard({
  label,
  value,
  suffix = "FCFA",
  sub,
  tone,
  icon,
  index,
  loading,
}: {
  label: string;
  value: number;
  suffix?: string;
  sub?: string;
  tone: KpiTone;
  icon: ReactNode;
  index: number;
  loading: boolean;
}) {
  return (
    <article
      className={`pd-kpi is-${tone}`}
      style={{ ["--i" as string]: index }}
    >
      <span className="pd-kpi-ico">
        <svg viewBox="0 0 24 24" aria-hidden>
          {icon}
        </svg>
      </span>
      <div className="pd-kpi-body">
        <span className="pd-kpi-label">{label}</span>
        {loading ? (
          <span className="pd-skel pd-skel-lg" />
        ) : (
          <strong className="pd-kpi-value">
            <CountUp value={value} suffix={suffix} />
          </strong>
        )}
        {sub ? <span className="pd-kpi-sub">{sub}</span> : null}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/*  Courbe / aire animée                                                */
/* ------------------------------------------------------------------ */

export type AreaSeries = {
  key: string;
  label: string;
  color: string;
  values: number[];
};

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return step * exp;
}

function compact(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(v % 1e6 ? 1 : 0).replace(".", ",")} M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} k`;
  return String(Math.round(v));
}

function smooth(points: [number, number][]): string {
  if (points.length === 0) return "";
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

export function AreaChart({
  labels,
  series,
  height = 270,
}: {
  labels: string[];
  series: AreaSeries[];
  height?: number;
}) {
  const W = 760;
  const pad = { t: 14, r: 18, b: 30, l: 54 };
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const n = labels.length;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const x = (i: number) => pad.l + (n < 2 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 1, 2, 3, 4].map((k) => (max * k) / 4);
  const every = Math.max(1, Math.ceil(n / 12));
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const signature = useMemo(
    () => `${n}-${series.map((s) => s.values.reduce((a, b) => a + b, 0)).join("-")}`,
    [n, series],
  );

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((px - pad.l) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, n < 2 ? 0 : idx)));
  }

  const tipLeft = hover === null ? 0 : (x(hover) / W) * 100;

  return (
    <div className="pd-chart" ref={boxRef}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label="Évolution"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`pd-g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={y(t)}
              y2={y(t)}
              stroke="#e8eef6"
              strokeDasharray={t === 0 ? undefined : "3 4"}
            />
            <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" className="pd-axis">
              {compact(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="pd-axis">
              {l}
            </text>
          ) : null,
        )}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => [x(i), y(v)] as [number, number]);
          const line = smooth(pts);
          const area =
            pts.length > 1
              ? `${line}L${x(n - 1).toFixed(1)} ${y(0)}L${x(0).toFixed(1)} ${y(0)}Z`
              : "";
          return (
            <g key={`${s.key}-${signature}`}>
              {si === 0 && area ? (
                <path d={area} fill={`url(#pd-g-${s.key})`} className="pd-area" />
              ) : null}
              <path
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                className="pd-line"
                style={{ animationDelay: `${si * 0.15}s` }}
              />
              {pts.length === 1 ? (
                <circle cx={pts[0][0]} cy={pts[0][1]} r={4} fill={s.color} />
              ) : null}
            </g>
          );
        })}
        {hover !== null ? (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.t}
              y2={pad.t + ih}
              stroke="#9fb4cc"
              strokeDasharray="3 3"
            />
            {series.map((s) => (
              <circle
                key={s.key}
                cx={x(hover)}
                cy={y(s.values[hover] ?? 0)}
                r={4.5}
                fill="#fff"
                stroke={s.color}
                strokeWidth={2.4}
              />
            ))}
          </g>
        ) : null}
      </svg>
      {hover !== null ? (
        <div
          className="pd-tip"
          style={{ left: `${Math.min(Math.max(tipLeft, 12), 88)}%` }}
        >
          <b>{labels[hover]}</b>
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label} · {nf.format(Math.round(s.values[hover] ?? 0))} FCFA
            </span>
          ))}
        </div>
      ) : null}
      <ul className="pd-legend-inline">
        {series.map((s) => (
          <li key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Anneau animé                                                        */
/* ------------------------------------------------------------------ */

export type DonutSlice = { key: string; label: string; value: number; color: string };

export function Donut({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: DonutSlice[];
  centerLabel: string;
  centerValue: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 70;
  const C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="pd-donut">
      <div className="pd-donut-ring">
        <svg viewBox="0 0 200 200" role="img" aria-label="Répartition">
          <circle cx="100" cy="100" r={r} fill="none" stroke="#eef3f9" strokeWidth="26" />
          {total > 0
            ? slices
                .filter((s) => s.value > 0)
                .map((s) => {
                  const len = (s.value / total) * C;
                  const gap = Math.min(3, len * 0.1);
                  const seg = (
                    <circle
                      key={s.key}
                      cx="100"
                      cy="100"
                      r={r}
                      fill="none"
                      stroke={s.color}
                      strokeWidth="26"
                      strokeDasharray={`${Math.max(len - gap, 0)} ${C}`}
                      strokeDashoffset={-acc}
                      transform="rotate(-90 100 100)"
                      className="pd-seg"
                      style={{
                        ["--da" as string]: `${Math.max(len - gap, 0)} ${C}`,
                        ["--c" as string]: `${C}`,
                      }}
                    />
                  );
                  acc += len;
                  return seg;
                })
            : null}
        </svg>
        <div className="pd-donut-center">
          <small>{centerLabel}</small>
          <strong>{centerValue}</strong>
        </div>
      </div>
      <ul className="pd-donut-legend">
        {slices.map((s) => (
          <li key={s.key}>
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <b>{total ? Math.round((s.value / total) * 100) : 0} %</b>
            <em>{nf.format(Math.round(s.value))}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Classement à barres                                                 */
/* ------------------------------------------------------------------ */

export function RankTable({
  rows,
  color,
  empty,
}: {
  rows: { name: string; qty?: number; ca: number }[];
  color: string;
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.ca));
  if (!rows.length) return <p className="pd-empty">{empty}</p>;
  return (
    <ol className="pd-rank">
      {rows.map((r, i) => (
        <li key={`${r.name}-${i}`} style={{ ["--i" as string]: i }}>
          <span className="pd-rank-n">{i + 1}</span>
          <div className="pd-rank-main">
            <div className="pd-rank-top">
              <strong>{r.name}</strong>
              <span>{nf.format(Math.round(r.ca))} FCFA</span>
            </div>
            <div className="pd-rank-bar">
              <i style={{ width: `${(r.ca / max) * 100}%`, background: color }} />
            </div>
            {r.qty !== undefined ? (
              <small>
                {r.qty} vendu{r.qty > 1 ? "s" : ""}
              </small>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
