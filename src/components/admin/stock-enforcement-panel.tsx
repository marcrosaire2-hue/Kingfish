"use client";

import { useCallback, useEffect, useState } from "react";
import { BrandLoader } from "@/components/brand-loader";
import { formatDateFr } from "@/components/achats/achats-shared";
import type { VenteSite } from "@/lib/types";

type SiteStatus = {
  site: VenteSite;
  label: string;
  ventesSansStock: boolean;
  enforceStock: boolean;
};

type Payload = {
  date: string;
  sites: SiteStatus[];
  error?: string;
};

type Props = {
  className?: string;
};

export function StockEnforcementPanel({ className }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busySite, setBusySite] = useState<VenteSite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ventes-stock", { cache: "no-store" });
      const body = (await res.json()) as Payload;
      if (!res.ok) throw new Error(body.error || "Chargement impossible.");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(site: VenteSite, enforceStock: boolean) {
    if (!data || busySite) return;
    const row = data.sites.find((s) => s.site === site);
    if (!row) return;
    setBusySite(site);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/ventes-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site, enforceStock, date: data.date }),
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible.");
      setData((prev) =>
        prev
          ? {
              ...prev,
              sites: prev.sites.map((row) =>
                row.site === site
                  ? {
                      ...row,
                      enforceStock,
                      ventesSansStock: !enforceStock,
                    }
                  : row,
              ),
            }
          : prev,
      );
      setFlash(
        enforceStock
          ? `${row.label} : vente plafonnée au stock.`
          : `${row.label} : vente libre (hors stock).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusySite(null);
    }
  }

  return (
    <section className={`panel admin-stock-policy${className ? ` ${className}` : ""}`}>
      <div className="panel-head">
        <h2 className="panel-title">Vente selon le stock</h2>
        <p className="muted admin-stock-policy-lead">
          Oblige les gérants à respecter le stock disponible pour la journée.
          Désactivé = vente libre (articles dégrisés).
        </p>
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      {flash ? (
        <p className="admin-stock-policy-flash" role="status">
          {flash}
        </p>
      ) : null}

      {loading ? (
        <BrandLoader variant="ligne" label="Chargement du réglage…" />
      ) : data ? (
        <>
          <p className="muted admin-stock-policy-date">
            Jour concerné : <strong>{formatDateFr(data.date)}</strong>
          </p>
          <ul className="admin-stock-policy-list">
            {data.sites.map((row) => (
              <li key={row.site} className="admin-stock-policy-row">
                <div className="admin-stock-policy-row-main">
                  <strong>{row.label}</strong>
                  <span className="muted">
                    {row.enforceStock
                      ? "Les gérants ne peuvent vendre que le stock restant."
                      : "Vente libre — le stock n'est pas bloquant."}
                  </span>
                </div>
                <button
                  type="button"
                  className={`btn${row.enforceStock ? " btn-primary" : " btn-ghost"}`}
                  disabled={busySite !== null}
                  aria-pressed={row.enforceStock}
                  onClick={() => void toggle(row.site, !row.enforceStock)}
                >
                  {busySite === row.site
                    ? "…"
                    : row.enforceStock
                      ? "Désactiver"
                      : "Activer"}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
