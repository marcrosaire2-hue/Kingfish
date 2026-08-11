"use client";

import { useState } from "react";

/**
 * Bouton d’export Excel réutilisable.
 * `onExport` peut être async (fetch + génération du fichier).
 */
export function ExportExcelButton({
  onExport,
  label = "Excel",
  disabled = false,
  className = "btn btn-ghost",
}: {
  onExport: () => void | Promise<void>;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await onExport();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="export-excel-wrap">
      <button
        type="button"
        className={className}
        onClick={() => void handleClick()}
        disabled={disabled || busy}
        title={error ?? "Exporter en Excel (.xlsx)"}
      >
        {busy ? "Export…" : label}
      </button>
      {error ? (
        <span className="export-excel-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
