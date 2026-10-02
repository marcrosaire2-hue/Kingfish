"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ContextBar } from "@/components/context-bar";
import {
  CAISSE_LABELS,
  CAISSE_SHORT_LABELS,
  ZONE_CAISSES,
  canUseCaisse,
  defaultCaisse,
} from "@/lib/caisse-model";
import { formatFcfa } from "@/lib/format";
import type { CaisseKey, FondsCaisse } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import { useSession } from "@/components/session-provider";
import { FondsCaisseSuivi } from "@/components/fonds-caisse/fonds-caisse-suivi";
import "@/components/achats/achats-page.css";

export function FondsCaissePage() {
  const session = useSession();
  if (!session?.user) return <BrandLoader />;
  if (session.user.role === "admin") return <FondsCaisseSuivi />;
  return <FondsCaisseSaisie />;
}

function FondsCaisseSaisie() {
  const session = useSession();
  const [selectedCaisse, setSelectedCaisse] = useState<CaisseKey>(
    session?.user ? defaultCaisse(session.user) : "gbegamey",
  );
  const [date, setDate] = useState(todayIsoDate());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fondsCaisse, setFondsCaisse] = useState<FondsCaisse | null>(null);
  const [formData, setFormData] = useState({
    soldePrevision: 0,
    soldeReel: 0,
    justificationEcart: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const user = session?.user;
  const allowedCaisses = user
    ? ZONE_CAISSES.filter((c) => canUseCaisse(user, c))
    : [];

  const ecart = formData.soldeReel - formData.soldePrevision;
  const today = todayIsoDate();

  const loadFondsCaisse = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        action: "today",
        caisse: selectedCaisse,
        date,
      });
      const response = await fetch(`/api/fonds-caisse?${params}`);
      if (!response.ok) throw new Error("Erreur lors du chargement");

      const result = await response.json();
      if (result.fondsCaisse) {
        setFondsCaisse(result.fondsCaisse);
        setFormData({
          soldePrevision: result.fondsCaisse.soldePrevision,
          soldeReel: result.fondsCaisse.soldeReel,
          justificationEcart: result.fondsCaisse.justificationEcart || "",
        });
      } else {
        setFondsCaisse(null);
        setFormData({
          soldePrevision: 0,
          soldeReel: 0,
          justificationEcart: "",
        });
      }
    } catch (err) {
      console.error("Erreur:", err);
      setError("Erreur lors du chargement des données");
    } finally {
      setLoading(false);
    }
  }, [selectedCaisse, date]);

  useEffect(() => {
    if (!user) return;
    loadFondsCaisse();
  }, [selectedCaisse, date, user, loadFondsCaisse]);

  const handleSave = useCallback(async () => {
    if (!user) return;
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      if (Math.abs(ecart) > 0 && !formData.justificationEcart.trim()) {
        setError("Veuillez justifier l'écart");
        setSaving(false);
        return;
      }

      const payload = {
        ...(fondsCaisse && { id: fondsCaisse.id }),
        date,
        caisse: selectedCaisse,
        site: user.site || null,
        soldePrevision: formData.soldePrevision,
        soldeReel: formData.soldeReel,
        justificationEcart: formData.justificationEcart || null,
      };

      const response = await fetch(
        `/api/fonds-caisse`,
        {
          method: fondsCaisse ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Erreur lors de la sauvegarde");
      }

      const result = await response.json();
      setFondsCaisse(result.fondsCaisse);
      setSuccess("Fonds de caisse enregistré");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error("Erreur:", err);
      setError(err instanceof Error ? err.message : "Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }, [fondsCaisse, selectedCaisse, date, formData, ecart, user]);

  if (!session || !user) {
    return <BrandLoader />;
  }

  return (
    <AppShell
      title="Fonds de Caisse"
      subtitle="Solde prévisionnel et réel"
      mainClassName="main-achats"
      actions={
        <>
          {allowedCaisses.length > 1 ? (
            <div className="site-switch" role="tablist" aria-label="Caisse">
              {allowedCaisses.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={selectedCaisse === c}
                  className={`site-btn${selectedCaisse === c ? " is-active" : ""}`}
                  onClick={() => setSelectedCaisse(c)}
                >
                  {CAISSE_SHORT_LABELS[c]}
                </button>
              ))}
            </div>
          ) : null}
          <Link href="/caisse" className="btn btn-ghost">
            → Caisse
          </Link>
        </>
      }
    >
      <div className="achats-page">
        <ContextBar
          date={date}
          onDateChange={setDate}
          siteLabel={CAISSE_SHORT_LABELS[selectedCaisse]}
        />

        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}

        {success && (
          <p className="achats-flash" role="status">
            {success}
          </p>
        )}

        {loading ? (
          <BrandLoader />
        ) : (
          <>
            <section className="achats-composer" aria-label="Saisie du fonds de caisse">
              <header className="achats-composer-head">
                <h2>Saisie du fonds</h2>
                <p>
                  {fondsCaisse
                    ? "Mise à jour du fonds de caisse"
                    : "Enregistrez les soldes prévisionnel et réel"}
                </p>
              </header>
              <form className="achats-composer-grid">
                <label className="achats-field">
                  <span>Date</span>
                  <input
                    type="date"
                    value={date}
                    max={today}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </label>

                <label className="achats-field">
                  <span>Solde prévisionnel</span>
                  <div className="achats-price-wrap">
                    <input
                      type="number"
                      value={formData.soldePrevision}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          soldePrevision: parseInt(e.target.value, 10) || 0,
                        })
                      }
                      required
                    />
                    <span className="achats-price-suffix">FCFA</span>
                  </div>
                </label>

                <label className="achats-field">
                  <span>Solde réel</span>
                  <div className="achats-price-wrap">
                    <input
                      type="number"
                      value={formData.soldeReel}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          soldeReel: parseInt(e.target.value, 10) || 0,
                        })
                      }
                      required
                    />
                    <span className="achats-price-suffix">FCFA</span>
                  </div>
                </label>

                {Math.abs(ecart) > 0 && (
                  <label className="achats-field achats-field-grow">
                    <span>Justification de l'écart</span>
                    <textarea
                      value={formData.justificationEcart}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          justificationEcart: e.target.value,
                        })
                      }
                      required
                      rows={3}
                      placeholder="Décrivez la raison de cet écart..."
                    />
                  </label>
                )}

                <button
                  type="button"
                  className="btn btn-primary achats-submit"
                  disabled={saving}
                  onClick={handleSave}
                >
                  {saving ? "…" : fondsCaisse ? "Mettre à jour" : "Enregistrer"}
                </button>
              </form>
            </section>

            <div className="achats-stats" aria-label="Résumé du fonds">
              <article className="achats-stat">
                <span>Solde prévisionnel</span>
                <strong>{formatFcfa(formData.soldePrevision)}</strong>
              </article>
              <article className="achats-stat">
                <span>Solde réel</span>
                <strong>{formatFcfa(formData.soldeReel)}</strong>
              </article>
              <article className={`achats-stat ${
                ecart === 0 ? "is-gold" : ecart > 0 ? "is-blue" : ""
              }`}>
                <span>Écart</span>
                <strong>{formatFcfa(ecart)}</strong>
              </article>
            </div>

            {fondsCaisse && (
              <p className="achats-metadata">
                Créé par {fondsCaisse.actorName} •{" "}
                {new Date(fondsCaisse.createdAt).toLocaleString("fr-FR")}
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
