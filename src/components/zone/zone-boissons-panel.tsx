"use client";

import { useEffect, useMemo, useState } from "react";
import { RegistreDrawer } from "@/components/registre-drawer";
import {
  computeBoissonsDay,
  createEmptyBoissonsDay,
  formatCasiers,
  movementTypeLabelBoissons,
} from "@/lib/boissons-calc";
import { formatFcfa, formatUpdatedAt } from "@/lib/format";
import type {
  BoissonsDay,
  BoissonsLine,
  BoissonsMovement,
  Drink,
  VenteLogEntry,
  VenteSite,
} from "@/lib/types";
import { BrandLoader } from "@/components/brand-loader";

type Payload = {
  day: BoissonsDay;
  drinks: Drink[];
  exits?: VenteLogEntry[];
  caJournal?: number;
};

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ZoneBoissonsPanel({
  date,
  site,
}: {
  date: string;
  site: VenteSite;
}) {
  const [day, setDay] = useState<BoissonsDay | null>(null);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [exits, setExits] = useState<VenteLogEntry[]>([]);
  const [caJournal, setCaJournal] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftBuy, setDraftBuy] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [registreOpen, setRegistreOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/boissons?date=${encodeURIComponent(date)}&site=${site}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setDay(body.day);
      setDrinks(body.drinks);
      setExits(body.exits ?? []);
      setCaJournal(Number(body.caJournal) || 0);
      setDirty(false);
      setDraftBuy({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setDay(createEmptyBoissonsDay(date, []));
      setDrinks([]);
      setExits([]);
      setCaJournal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, site]);

  const computed = useMemo(() => {
    if (!day) return null;
    return computeBoissonsDay(day, drinks);
  }, [day, drinks]);

  function patchLine(productId: string, patch: Partial<BoissonsLine>) {
    if (!day) return;
    setDay({
      ...day,
      lines: day.lines.map((l) =>
        l.productId === productId ? { ...l, ...patch } : l,
      ),
    });
    setDirty(true);
  }

  async function handleSave() {
    if (!day) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/boissons", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: day.date,
          status: day.status,
          lines: day.lines,
          site,
        }),
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur d’enregistrement");
      setDay(body.day);
      setDrinks(body.drinks);
      setDirty(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d’enregistrement");
    } finally {
      setSaving(false);
    }
  }

  async function submitPurchase(productId: string, raw: string) {
    const qty = Math.round(Number(raw.replace(",", ".")) || 0);
    if (qty <= 0) return;
    setBusyId(`buy-${productId}`);
    setError(null);
    try {
      const res = await fetch("/api/boissons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, productId, qty, site }),
      });
      const body = (await res.json()) as Payload & {
        movement?: BoissonsMovement;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setDrinks(body.drinks);
      setExits(body.exits ?? exits);
      setDraftBuy((d) => ({ ...d, [productId]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelMovement(m: BoissonsMovement) {
    if (
      !window.confirm(
        `Annuler cet achat ?\n\n+${m.qty} casier(s) × ${m.name}`,
      )
    ) {
      return;
    }
    setBusyId(`cancel-${m.id}`);
    setError(null);
    try {
      const res = await fetch("/api/boissons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          date,
          movementId: m.id,
          site,
        }),
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Annulation impossible");
      setDay(body.day);
      setDrinks(body.drinks);
      setExits(body.exits ?? exits);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible");
    } finally {
      setBusyId(null);
    }
  }

  const siteLabel = site === "zogbo" ? "Zogbo" : "Gbégamey";
  const qtySite = computed
    ? site === "zogbo"
      ? computed.totals.soldZogbo
      : computed.totals.soldGbegamey
    : 0;
  const siteExits = exits.filter((e) => e.site === site);
  const movementCount =
    (computed?.movements.length ?? 0) + siteExits.length;

  return (
    <div className="zone-panel">
      <div className="param-meta">
        <p>
          Boissons — <strong>{siteLabel}</strong>
          {" · "}
          CA journal
          {" · "}
          Sauvegarde :{" "}
          <strong>
            {loading ? "…" : formatUpdatedAt(day?.updatedAt ?? null)}
          </strong>
        </p>
        <button
          type="button"
          className={`btn btn-primary${savedFlash && !dirty ? " btn-saved" : ""}`}
          onClick={handleSave}
          disabled={!dirty || saving || loading || !day}
        >
          {saving
            ? "Enregistrement…"
            : savedFlash
              ? "Enregistré"
              : dirty
                ? "Enregistrer notes"
                : "À jour"}
        </button>
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      <div className="ui-info" role="note">
        <span className="ui-info-mark" aria-hidden>
          i
        </span>
        <p>
          Stock et achats en <strong>casiers</strong>. Les ventes (page Vente)
          sont en <strong>bouteilles</strong> et baissent le stock actuel.
          Compté = contrôle physique en casiers.
        </p>
      </div>

      {computed && computed.totals.missingSalePrice > 0 ? (
        <p className="warn-inline">
          {computed.totals.missingSalePrice} sans prix de vente
        </p>
      ) : null}

      <div className="stat-row">
        <div className="stat-chip">
          <span className="stat-label">Stock actuel (cas.)</span>
          <span className="stat-value mono">
            {computed
              ? formatCasiers(
                  computed.lines.reduce(
                    (s, l) => s + Math.max(0, l.theoreticalRemaining),
                    0,
                  ),
                )
              : 0}
          </span>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Achats (casiers)</span>
          <span className="stat-value mono">
            {computed?.totals.purchases ?? 0}
          </span>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Vendu {siteLabel} (bt)</span>
          <span className="stat-value mono">{qtySite}</span>
        </div>
        <div className="stat-chip accent">
          <span className="stat-label">CA journal Boissons</span>
          <span className="stat-value mono">{formatFcfa(caJournal)}</span>
        </div>
      </div>

      <div className="toolbar-row">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setRegistreOpen(true)}
        >
          Registre · {movementCount}
        </button>
      </div>

      <section className="panel panel-wide">
        <table className="data-table zogbo-table">
          <thead>
            <tr>
              <th scope="col">Boisson</th>
              <th scope="col" className="col-qty">
                + Achat
                <span className="col-auto-tag">casiers</span>
              </th>
              <th scope="col" className="col-qty">
                Vendu {siteLabel}
                <span className="col-auto-tag">bouteilles</span>
              </th>
              <th scope="col" className="col-qty">
                Stock actuel
                <span className="col-auto-tag">saisie = comptage</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading || !computed ? (
              <tr>
                <td colSpan={4}>
                      <BrandLoader variant="ligne" label="Chargement…" />
                    </td>
              </tr>
            ) : computed.lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  Aucune boisson dans Paramètres.
                </td>
              </tr>
            ) : (
              computed.lines.map((line) => {
                const qty =
                  site === "zogbo" ? line.soldZogbo : line.soldGbegamey;
                const hasVariance =
                  line.variance !== null && line.variance !== 0;
                const missingPv = line.salePrice === null;
                const buyBusy = busyId === `buy-${line.productId}`;
                return (
                  <tr
                    key={line.productId}
                    className={
                      hasVariance || missingPv ? "row-warn" : undefined
                    }
                  >
                    <td className="cell-name">
                      {line.name}
                      <span className="cell-sub mono">
                        {line.unitsPerCasier} bt/cas. · init.{" "}
                        {formatCasiers(line.initialStock)} cas. · achats{" "}
                        {formatCasiers(line.purchases)} cas. · solde{" "}
                        {formatCasiers(line.available)} cas.
                        {" · "}
                        PA {formatFcfa(line.purchasePrice)}/bt
                        {" · "}
                        PV{" "}
                        {line.salePrice === null
                          ? "—"
                          : `${formatFcfa(line.salePrice)}/bt`}
                      </span>
                    </td>
                    <td className="col-qty">
                      <div className="mvt-entry">
                        <input
                          className="qty-input"
                          inputMode="numeric"
                          aria-label={`Achat casiers ${line.name}`}
                          placeholder="cas."
                          value={draftBuy[line.productId] ?? ""}
                          disabled={!!busyId}
                          onChange={(e) =>
                            setDraftBuy((d) => ({
                              ...d,
                              [line.productId]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              void submitPurchase(
                                line.productId,
                                draftBuy[line.productId] ?? "",
                              );
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-mvt btn-mvt-plus"
                          disabled={buyBusy || !!busyId}
                          onClick={() =>
                            void submitPurchase(
                              line.productId,
                              draftBuy[line.productId] ?? "",
                            )
                          }
                        >
                          {buyBusy ? "…" : "+"}
                        </button>
                      </div>
                    </td>
                    <td className="col-qty mono cell-readonly cell-auto">
                      {qty}
                      <span className="cell-sub">bt</span>
                    </td>
                    <td className="col-qty">
                      <input
                        className="qty-input"
                        inputMode="decimal"
                        aria-label={`Stock actuel casiers ${line.name}`}
                        placeholder={formatCasiers(
                          Math.max(0, line.theoreticalRemaining),
                        )}
                        value={line.counted ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value.trim().replace(",", ".");
                          if (raw === "") {
                            patchLine(line.productId, { counted: null });
                            return;
                          }
                          const n = Math.max(0, Number(raw) || 0);
                          patchLine(line.productId, {
                            counted: Math.round(n * 100) / 100,
                          });
                        }}
                      />
                      {line.counted !== null ? (
                        <span className="cell-sub muted">
                          théo. {formatCasiers(line.theoreticalRemaining)} cas.
                          · {line.stockBottles} bt
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <RegistreDrawer
        open={registreOpen}
        onClose={() => setRegistreOpen(false)}
        title="Registre Boissons"
        subtitle={`${siteLabel} · achats en casiers · ventes en bouteilles`}
      >
        <section className="drawer-section">
          <h3 className="panel-title">Entrées (achats)</h3>
          <p className="section-hint">
            Chaque achat est saisi en casiers, tracé ici, et peut être annulé
            tant que le stock le permet.
          </p>
          <table className="data-table zogbo-table zogbo-registre-table">
            <thead>
              <tr>
                <th scope="col">Heure</th>
                <th scope="col">Type</th>
                <th scope="col">Boisson</th>
                <th scope="col" className="col-qty">
                  Casiers
                </th>
                <th scope="col" className="col-qty">
                  Dispo après (cas.)
                </th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {!computed || computed.movements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Aucun achat pour l’instant.
                  </td>
                </tr>
              ) : (
                computed.movements.map((m) => {
                  const cancelled = !!m.cancelledAt;
                  return (
                    <tr
                      key={m.id}
                      className={cancelled ? "row-cancelled" : undefined}
                    >
                      <td className="mono">{formatTime(m.at)}</td>
                      <td>
                        <span className="hist-badge hist-badge-zogbo">
                          {movementTypeLabelBoissons(m.type)}
                        </span>
                      </td>
                      <td className="cell-name">{m.name}</td>
                      <td className="col-qty mono">+{m.qty} cas.</td>
                      <td className="col-qty mono cell-readonly">
                        {cancelled ? "—" : `${formatCasiers(m.stockAfter)} cas.`}
                      </td>
                      <td>
                        {cancelled ? (
                          <span className="muted">Annulé</span>
                        ) : (
                          <button
                            type="button"
                            className="btn-link"
                            disabled={!!busyId}
                            onClick={() => void cancelMovement(m)}
                          >
                            {busyId === `cancel-${m.id}` ? "…" : "Annuler"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>

        <section className="drawer-section">
          <h3 className="panel-title">Sorties (ventes {siteLabel})</h3>
          <p className="section-hint">
            Sorties en bouteilles, enregistrées sur la page Vente pour ce point.
          </p>
          <table className="data-table zogbo-table zogbo-registre-table">
            <thead>
              <tr>
                <th scope="col">Heure</th>
                <th scope="col">Type</th>
                <th scope="col">Boisson</th>
                <th scope="col" className="col-qty">
                  Qté (bt)
                </th>
                <th scope="col" className="col-money">
                  Montant
                </th>
              </tr>
            </thead>
            <tbody>
              {siteExits.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    Aucune vente boisson pour l’instant.
                  </td>
                </tr>
              ) : (
                siteExits.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">{formatTime(e.at)}</td>
                    <td>
                      <span className="hist-badge hist-badge-transfert">
                        Vente (sortie)
                      </span>
                    </td>
                    <td className="cell-name">{e.name}</td>
                    <td className="col-qty mono">
                      {e.qty > 0 ? "−" : "+"}
                      {Math.abs(e.qty)} bt
                    </td>
                    <td className="col-money mono">{formatFcfa(e.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </RegistreDrawer>
    </div>
  );
}
