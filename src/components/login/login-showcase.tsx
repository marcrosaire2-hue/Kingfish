import { APP_SITES_LABEL } from "@/lib/brand";
import {
  ArrowIcon,
  CalendarIcon,
  CartIcon,
  ChartIcon,
  CheckIcon,
  ProductionIcon,
  ShieldIcon,
  StockIcon,
} from "./login-icons";

const FEATURES = [
  {
    title: "Vente & caisse",
    detail: "Encaissement POS, tickets et suivi du service.",
    Icon: CartIcon,
    tone: "blue",
  },
  {
    title: "Production",
    detail: "Suivi cuisine et points de vente par site.",
    Icon: ProductionIcon,
    tone: "green",
  },
  {
    title: "Stock & achats",
    detail: "Inventaire, approvisionnement et déclaration des pertes.",
    Icon: StockIcon,
    tone: "purple",
  },
  {
    title: "Pilotage",
    detail: "Tableau de bord, journal des ventes et registre.",
    Icon: ChartIcon,
    tone: "gold",
  },
] as const;

/** Périodes normalisées 0–100 — illustration, pas de CA réel (API /api/synthese protégée JWT). */
const CHART_LABELS = [
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
  "S7",
  "S8",
  "S9",
  "S10",
  "S11",
  "S12",
];
const CURVE_VALUES = [42, 58, 52, 68, 62, 74, 70, 82, 76, 88, 84, 92];
const BAR_VALUES = [28, 38, 34, 46, 42, 52, 48, 58, 54, 62, 58, 66];

function LoginPerformancePreview() {
  const width = 420;
  const height = 168;
  const pad = { l: 32, r: 12, t: 10, b: 28 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const n = CHART_LABELS.length;
  const xAt = (i: number) =>
    pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad.t + innerH - (v / 100) * innerH;

  let curvePath = `M ${xAt(0)} ${yAt(CURVE_VALUES[0]!)}`;
  for (let i = 1; i < CURVE_VALUES.length; i++) {
    const x0 = xAt(i - 1);
    const x1 = xAt(i);
    const y0 = yAt(CURVE_VALUES[i - 1]!);
    const y1 = yAt(CURVE_VALUES[i]!);
    const cx = (x0 + x1) / 2;
    curvePath += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }
  const areaPath = `${curvePath} L ${xAt(n - 1)} ${pad.t + innerH} L ${xAt(0)} ${pad.t + innerH} Z`;

  return (
    <div className="login-chart-card">
      <div className="login-chart-card-head">
        <h3 className="login-chart-card-title">Aperçu des performances</h3>
        <span className="login-chart-period">
          <CalendarIcon />
          30 derniers jours
        </span>
      </div>
      <svg
        className="login-showcase-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Aperçu graphique des performances — illustration normalisée"
      >
        <defs>
          <linearGradient id="login-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,198,42,0.42)" />
            <stop offset="100%" stopColor="rgba(255,198,42,0)" />
          </linearGradient>
          <filter id="login-chart-glow" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={yAt(tick)}
              y2={yAt(tick)}
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="1"
            />
            <text
              x={pad.l - 8}
              y={yAt(tick) + 3.5}
              textAnchor="end"
              fill="rgba(255,255,255,0.45)"
              fontSize="9"
              fontWeight="600"
            >
              {tick}
            </text>
          </g>
        ))}
        {BAR_VALUES.map((h, i) => (
          <rect
            key={CHART_LABELS[i]}
            x={xAt(i) - 10}
            y={yAt(h)}
            width="20"
            height={pad.t + innerH - yAt(h)}
            rx="4"
            fill="rgba(255,255,255,0.06)"
          />
        ))}
        <path d={areaPath} fill="url(#login-chart-fill)" />
        <path
          d={curvePath}
          fill="none"
          stroke="rgba(255,198,42,0.95)"
          strokeWidth="2.8"
          strokeLinecap="round"
          filter="url(#login-chart-glow)"
        />
        {CURVE_VALUES.map((v, i) => (
          <g key={`pt-${CHART_LABELS[i]}`}>
            <circle cx={xAt(i)} cy={yAt(v)} r="5.5" fill="rgba(255,198,42,0.22)" />
            <circle
              cx={xAt(i)}
              cy={yAt(v)}
              r="3.2"
              fill="#fff"
              stroke="rgba(255,198,42,0.95)"
              strokeWidth="2"
            />
          </g>
        ))}
        {CHART_LABELS.map((label, i) => (
          <text
            key={label}
            x={xAt(i)}
            y={height - 6}
            textAnchor="middle"
            fill="rgba(255,255,255,0.5)"
            fontSize="8.5"
            fontWeight="600"
          >
            {label}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function LoginShowcase() {
  return (
    <section
      className="login-panel login-panel-showcase"
      aria-labelledby="login-showcase-title"
    >
      <div className="login-showcase-inner">
        <p className="login-showcase-kicker">{APP_SITES_LABEL}</p>
        <h2 id="login-showcase-title" className="login-showcase-title">
          Pilotez votre activité
          <br />
          <span className="login-showcase-title-accent">au quotidien</span>
        </h2>
        <p className="login-showcase-lead">
          Une plateforme unique pour la production, la vente et le stock —
          pensée pour les équipes sur le terrain.
        </p>

        <div className="login-showcase-desktop-only">
          <LoginPerformancePreview />

          <ul className="login-feature-grid">
            {FEATURES.map(({ title, detail, Icon, tone }) => (
              <li key={title} className="login-feature-card">
                <span className={`login-feature-icon login-feature-icon--${tone}`} aria-hidden>
                  <Icon />
                </span>
                <div className="login-feature-body">
                  <strong>{title}</strong>
                  <span>{detail}</span>
                </div>
                <span className="login-feature-arrow" aria-hidden>
                  <ArrowIcon />
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="login-security-banner">
          <span className="login-security-banner-icon" aria-hidden>
            <ShieldIcon />
          </span>
          <div className="login-security-banner-text">
            <strong>Données sécurisées et sauvegardées en temps réel</strong>
            <span>Gestion fiable, simple et efficace pour votre entreprise.</span>
          </div>
          <span className="login-security-banner-check" aria-hidden>
            <CheckIcon />
          </span>
        </div>
      </div>
    </section>
  );
}
