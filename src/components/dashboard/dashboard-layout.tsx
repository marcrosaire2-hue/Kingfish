"use client";

import type { ReactNode } from "react";

export type DashboardTab = { id: string; label: string };

export function DashboardShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `dash-page ${className}` : "dash-page"}>
      {children}
    </div>
  );
}

export function DashboardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `dash ${className}` : "dash"}>{children}</div>
  );
}

export function DashboardToolbar({
  tabs,
  activeTab,
  onTabChange,
  tabListLabel = "Période",
  filters,
  topEnd,
  showCurrency = true,
}: {
  tabs?: DashboardTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  tabListLabel?: string;
  filters?: ReactNode;
  topEnd?: ReactNode;
  showCurrency?: boolean;
}) {
  const hasTop =
    (tabs && tabs.length > 0) || topEnd || showCurrency;

  return (
    <div className="dash-toolbar panel">
      {hasTop ? (
        <div className="dash-toolbar-top">
          {tabs && tabs.length > 0 ? (
            <div
              className="section-tabs dash-period-tabs"
              role="tablist"
              aria-label={tabListLabel}
            >
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.id}
                  className={`section-tab${activeTab === t.id ? " is-active" : ""}`}
                  onClick={() => onTabChange?.(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}
          {topEnd}
          {showCurrency ? (
            <span className="context-pill context-pill-currency" title="Devise">
              FCFA
            </span>
          ) : null}
        </div>
      ) : null}
      {filters ? <div className="dash-toolbar-filters">{filters}</div> : null}
    </div>
  );
}

export function DashboardSectionNav<T extends string>({
  sections,
  active,
  onChange,
  label,
}: {
  sections: { id: T; label: string; badge?: number }[];
  active: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <nav className="dash-section-nav" role="tablist" aria-label={label}>
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={active === s.id}
          className={`dash-section-tab${active === s.id ? " is-active" : ""}`}
          onClick={() => onChange(s.id)}
        >
          {s.label}
          {s.badge != null ? (
            <span className="dash-section-badge">{s.badge}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

export type DashKpiTone = "accent" | "warn" | "muted";
export type DashKpiAccent =
  | "green"
  | "blue"
  | "purple"
  | "sky"
  | "orange"
  | "gold"
  | "muted";

export type DashKpiItem = {
  label: string;
  value: string;
  tone?: DashKpiTone;
  accent?: DashKpiAccent;
  icon?: ReactNode;
};

export function DashKpiGrid({
  items,
  className,
}: {
  items: DashKpiItem[];
  className?: string;
}) {
  return (
    <div className={className ? `dash-kpi-grid ${className}` : "dash-kpi-grid"}>
      {items.map((it) => (
        <div
          key={it.label}
          className={`dash-kpi${it.tone ? ` dash-kpi-${it.tone}` : ""}${it.accent ? ` dash-kpi-tone-${it.accent}` : ""}${it.icon ? " has-icon" : ""}`}
        >
          {it.icon ? (
            <span className="dash-kpi-ico" aria-hidden>
              {it.icon}
            </span>
          ) : null}
          <div className="dash-kpi-copy">
            <span className="dash-kpi-label">{it.label}</span>
            <span className="dash-kpi-value mono">{it.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
