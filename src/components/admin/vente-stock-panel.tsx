"use client";

import { useEffect, useState } from "react";
import "./vente-stock-panel.css";

type SiteStatus = {
  site: string;
  label: string;
  enforceStock: boolean;
  boissonsSelonStock?: boolean;
};

type StatusResponse = {
  date?: string;
  sites?: SiteStatus[];
  enforceStock?: boolean;
  boissonsSelonStock?: boolean;
  error?: string;
};

/** Le mode de vente de Gbégamey : vente libre, ou vente selon le stock. */
export function VenteStockPanel() {
  const [date, setDate] = useState<string | null>(null);
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/admin/ventes-stock", { cache: "no-store" });
        const body = (await res.json()) as StatusResponse;
        if (!res.ok) throw new Error(body.error || "Erreur de chargement");
        if (cancelled) return;
        setDate(body.date ?? null);
        setStatus(body.sites?.find((s) => s.site === "gbegamey") ?? null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erreur de chargement");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function changeMode(enforceStock: boolean, famille?: "boissons") {
    if (!status || !date || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ventes-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site: status.site, enforceStock, date, famille }),
      });
      const body = (await res.json()) as StatusResponse;
      if (!res.ok) throw new Error(body.error || "Changement impossible");
      setStatus(
        famille === "boissons"
          ? { ...status, boissonsSelonStock: body.boissonsSelonStock === true }
          : { ...status, enforceStock: body.enforceStock === true },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Changement impossible");
    } finally {
      setBusy(false);
    }
  }

  if (!status && !error) return null;

  return (
    <section className="panel vente-stock-panel" aria-label="Mode de vente">
      {status ? (
        <>
          <div className="vente-stock-copy">
            <h3>Ventes {status.label}</h3>
            <p role="status">
              {status.enforceStock
                ? "Vente selon le stock : un article épuisé ne peut plus être vendu."
                : "Vente libre : les articles se vendent sans contrôle du stock."}
            </p>
            <small>Ce choix s’applique dès aujourd’hui et les jours suivants.</small>
          </div>
          <button
            type="button"
            className={status.enforceStock ? "btn" : "btn btn-primary"}
            disabled={busy}
            onClick={() => void changeMode(!status.enforceStock)}
          >
            {busy
              ? "…"
              : status.enforceStock
                ? "Repasser en vente libre"
                : "Lancer la vente selon le stock"}
          </button>
          {status.enforceStock ? null : (
            <>
              <div className="vente-stock-copy">
                <h3>Boissons</h3>
                <p role="status">
                  {status.boissonsSelonStock
                    ? "Boissons selon le stock : une boisson épuisée ne peut plus être vendue, le reste reste en vente libre."
                    : "Boissons en vente libre."}
                </p>
              </div>
              <button
                type="button"
                className={status.boissonsSelonStock ? "btn" : "btn btn-primary"}
                disabled={busy}
                onClick={() => void changeMode(!status.boissonsSelonStock, "boissons")}
              >
                {busy
                  ? "…"
                  : status.boissonsSelonStock
                    ? "Boissons en vente libre"
                    : "Boissons selon le stock"}
              </button>
            </>
          )}
        </>
      ) : null}
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
