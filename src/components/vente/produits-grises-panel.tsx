"use client";

import { useMemo, useState } from "react";
import "./produits-grises-panel.css";
import type { VenteProduct, VenteSite } from "@/lib/types";

const GROUPES = [
  ["plat", "Plats"],
  ["local", "Accompagnements"],
  ["boisson", "Boissons"],
] as const;

/** Réservé à l'administrateur : retire un article de la vente, sur ce site. */
export function ProduitsGrisesPanel({
  products,
  site,
  onChanged,
}: {
  products: VenteProduct[];
  site: VenteSite;
  onChanged: () => Promise<void> | void;
}) {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nbGrises = products.filter((p) => p.griseAdmin).length;
  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [products, search]);

  async function basculer(p: VenteProduct) {
    const key = `${p.kind}:${p.productId}`;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/produits-grises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site,
          kind: p.kind,
          productId: p.productId,
          name: p.name,
          grise: !p.griseAdmin,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Modification impossible.");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modification impossible.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="vente-panel grise-panel">
      <summary>
        Griser des articles
        {nbGrises ? <span className="grise-count">{nbGrises} grisé(s)</span> : null}
      </summary>
      <p className="muted grise-hint">
        Un article grisé reste visible mais ne peut plus être vendu sur ce site, jusqu’à ce que vous le remettiez en vente.
      </p>
      <input
        className="grise-search"
        type="search"
        placeholder="Rechercher un article"
        aria-label="Rechercher un article à griser"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      {GROUPES.map(([kind, label]) => {
        const liste = visibles.filter((p) => p.kind === kind);
        if (!liste.length) return null;
        return (
          <section key={kind}>
            <h3 className="grise-title">{label}</h3>
            <ul className="grise-list">
              {liste.map((p) => {
                const key = `${p.kind}:${p.productId}`;
                return (
                  <li key={key} className={p.griseAdmin ? "is-grise" : ""}>
                    <span>{p.name}</span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy !== null}
                      aria-label={`${p.griseAdmin ? "Remettre en vente" : "Griser"} ${p.name}`}
                      onClick={() => void basculer(p)}
                    >
                      {busy === key ? "…" : p.griseAdmin ? "Remettre en vente" : "Griser"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </details>
  );
}
