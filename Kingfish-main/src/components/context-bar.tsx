"use client";

import { todayIsoDate } from "@/lib/zogbo-calc";

/** Barre de contexte : date optionnelle + devise FCFA + actions */
export function ContextBar({
  date,
  onDateChange,
  dateDisabled,
  siteLabel,
  children,
}: {
  date?: string;
  onDateChange?: (next: string) => void;
  dateDisabled?: boolean;
  siteLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="context-bar">
      <div className="context-bar-main">
        {date !== undefined && onDateChange ? (
          <label className="date-field date-field-pill">
            <span>Jour</span>
            <input
              type="date"
              value={date}
              disabled={dateDisabled}
              max={todayIsoDate()}
              onChange={(e) => {
                const v = e.target.value;
                // Ignore clear / valeur incomplète (sinon le filtre « saute »).
                if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                onDateChange(v);
              }}
            />
          </label>
        ) : null}
        {siteLabel ? (
          <span className="context-pill context-pill-site">{siteLabel}</span>
        ) : null}
        <span className="context-pill context-pill-currency" title="Devise">
          FCFA
        </span>
      </div>
      {children ? <div className="context-bar-actions">{children}</div> : null}
    </div>
  );
}
