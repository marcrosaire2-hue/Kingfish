"use client";

import { useEffect, useMemo, useState } from "react";
import { RegistreDrawer } from "@/components/registre-drawer";
import {
  computeCombosDay,
  createEmptyCombosDay,
  movementTypeLabelCombos,
} from "@/lib/combos-calc";
import { formatFcfa, formatUpdatedAt } from "@/lib/format";
import type {
  ComboDish,
  CombosDay,
  CombosLine,
  CombosMovement,
  CombosMovementType,
  VenteLogEntry,
  VenteSite,
} from "@/lib/types";

type Payload = {
  day: CombosDay;
  combos: ComboDish[];
  exits?: VenteLogEntry[];
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

export function ZoneCombosPanel({
  date,
  site,
}: {
  date: string;
  site: VenteSite;
}) {
  const [day, setDay] = useState<CombosDay | null>(null);
  const [combos, setCombos] = useState<ComboDish[]>([]);
  const [exits, setExits] = useState<VenteLogEntry[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftPrepare, setDraftPrepare] = useState<Record<string, string>>({});
  const [draftSend, setDraftSend] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [registreOpen, setRegistreOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/combos?date=${encodeURIComponent(date)}&site=${site}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setDay(body.day);
      setCombos(body.combos);
      setExits(body.exits ?? []);
      setDirty(false);
      setDraftPrepare({});
      setDraftSend({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setDay(createEmptyCombosDay(date, []));
      setCombos([]);
      setExits([]);
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
    return computeCombosDay(day, combos);
  }, [day, combos]);

  function patchLine(productId: string, patch: Partial<CombosLine>) {
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
      const res = await fetch("/api/combos", {
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
      setCombos(body.combos);
      setDirty(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d’enregistrement");
    } finally {
      setSaving(false);
    }
  }

  async function submitMovement(
    productId: string,
    type: CombosMovementType,
    raw: string,
  ) {
    const qty = Math.round(Number(raw.replace(",", ".")) || 0);
    if (qty <= 0) return;
    setBusyId(`${productId}-${type}`);
    setError(null);
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, productId, type, qty, site }),
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setCombos(body.combos);
      setExits(body.exits ?? exits);
      if (type === "prepare") {
        setDraftPrepare((d) => ({ ...d, [productId]: "" }));
      } else {
        setDraftSend((d) => ({ ...d, [productId]: "" }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelMovement(m: CombosMovement) {
    if (
      !window.confirm(
        `Annuler ce mouvement ?\n\n${movementTypeLabelCombos(m.type)} · ${m.qty} × ${m.name}`,
      )
    ) {
      return;
    }
    setBusyId(`cancel-${m.id}`);
    setError(null);
    try {
      const res = await fetch("/api/combos", {
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
      setCombos(body.combos);
      setExits(body.exits ?? exits);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible");
    } finally {
      setBusyId(null);
    }
  }

  const siteLabel = site === "zogbo" ? "Zogbo" : "Gbégamey";
  const caSite = computed
    ? site === "zogbo"
      ? computed.totals.soldAmountZogbo
      : computed.totals.soldAmountGbegamey
    : 0;
  const qtySite = computed
    ? site === "zogbo"
      ? computed.totals.soldZogbo
      : computed.totals.soldGbegamey
    : 0;
  const stockSite = computed
    ? site === "zogbo"
      ? computed.totals.stockActuelZogbo
      : computed.totals.stockActuelGbegamey
    : 0;
  const siteExits = exits.filter((e) => e.site === site);
  const movementCount =
    (computed?.movements.length ?? 0) + siteExits.length;

  return (
    <div className="zone-panel">
      <div className="param-meta">
        <p>
          Combos — <strong>{siteLabel}</strong>
          {" · "}
          CA en FCFA
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
          {site === "zogbo" ? (
            <>
              Préparer et envoyer à Gbégamey — mouvements dans le{" "}
              <strong>Registre</strong>. Ventes via la page Vente.
            </>
          ) : (
            <>
              Reçu auto depuis Zogbo. <strong>Stock actuel</strong> = solde −
              ventes. Vendre via Vente.
            </>
          )}
        </p>
      </div>

      <div className="stat-row">
        <div className="stat-chip">
          <span className="stat-label">Stock actuel</span>
          <span className="stat-value mono">{stockSite}</span>
        </div>
        {site === "zogbo" ? (
          <>
            <div className="stat-chip">
              <span className="stat-label">Préparé</span>
              <span className="stat-value mono">
                {computed?.totals.prepared ?? 0}
              </span>
            </div>
            <div className="stat-chip">
              <span className="stat-label">Envoyé</span>
              <span className="stat-value mono">
                {computed?.totals.sent ?? 0}
              </span>
            </div>
          </>
        ) : null}
        <div className="stat-chip">
          <span className="stat-label">Vendu {siteLabel}</span>
          <span className="stat-value mono">{qtySite}</span>
        </div>
        <div className="stat-chip accent">
          <span className="stat-label">CA Combos {siteLabel}</span>
          <span className="stat-value mono">{formatFcfa(caSite)}</span>
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
        {site === "zogbo" ? (
          <table className="data-table zogbo-table">
            <thead>
              <tr>
                <th scope="col">Combo</th>
                <th scope="col" className="col-qty">
                  Dispo
                  <span className="col-auto-tag">préparé − envoyé</span>
                </th>
                <th scope="col" className="col-qty">
                  + Préparé
                </th>
                <th scope="col" className="col-qty">
                  Envoyer
                </th>
                <th scope="col" className="col-qty">
                  Vendu
                  <span className="col-auto-tag">via Vente</span>
                </th>
                <th scope="col" className="col-qty">
                  Stock actuel
                  <span className="col-auto-tag">dispo − vendu</span>
                </th>
                <th scope="col" className="col-qty">
                  Compté
                </th>
              </tr>
            </thead>
            <tbody>
              {loading || !computed ? (
                <tr>
                  <td colSpan={7} className="muted">
                    Chargement…
                  </td>
                </tr>
              ) : computed.lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    Aucun combo dans Paramètres.
                  </td>
                </tr>
              ) : (
                computed.lines.map((line) => {
                  const hasVariance =
                    line.varianceZogbo !== null && line.varianceZogbo !== 0;
                  const prepBusy = busyId === `${line.productId}-prepare`;
                  const sendBusy = busyId === `${line.productId}-send`;
                  return (
                    <tr
                      key={line.productId}
                      className={hasVariance ? "row-warn" : undefined}
                    >
                      <td className="cell-name">
                        {line.name}
                        <span className="cell-sub mono">
                          PU {formatFcfa(line.unitPrice)}
                        </span>
                      </td>
                      <td className="col-qty mono cell-readonly cell-auto">
                        {line.stockZogbo}
                      </td>
                      <td className="col-qty">
                        <div className="mvt-entry">
                          <input
                            className="qty-input"
                            inputMode="numeric"
                            aria-label={`Préparé ${line.name}`}
                            placeholder="qty"
                            value={draftPrepare[line.productId] ?? ""}
                            disabled={!!busyId}
                            onChange={(e) =>
                              setDraftPrepare((d) => ({
                                ...d,
                                [line.productId]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                void submitMovement(
                                  line.productId,
                                  "prepare",
                                  draftPrepare[line.productId] ?? "",
                                );
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-mvt btn-mvt-plus"
                            disabled={prepBusy || !!busyId}
                            onClick={() =>
                              void submitMovement(
                                line.productId,
                                "prepare",
                                draftPrepare[line.productId] ?? "",
                              )
                            }
                          >
                            {prepBusy ? "…" : "+"}
                          </button>
                        </div>
                      </td>
                      <td className="col-qty">
                        <div className="mvt-entry">
                          <input
                            className="qty-input"
                            inputMode="numeric"
                            aria-label={`Envoyer ${line.name}`}
                            placeholder="qty"
                            value={draftSend[line.productId] ?? ""}
                            disabled={!!busyId}
                            onChange={(e) =>
                              setDraftSend((d) => ({
                                ...d,
                                [line.productId]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                void submitMovement(
                                  line.productId,
                                  "send",
                                  draftSend[line.productId] ?? "",
                                );
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-mvt btn-mvt-send"
                            disabled={sendBusy || !!busyId}
                            onClick={() =>
                              void submitMovement(
                                line.productId,
                                "send",
                                draftSend[line.productId] ?? "",
                              )
                            }
                          >
                            {sendBusy ? "…" : "→"}
                          </button>
                        </div>
                      </td>
                      <td className="col-qty mono cell-readonly cell-auto">
                        {line.soldZogbo}
                      </td>
                      <td className="col-qty mono cell-readonly stock-actuel">
                        {line.stockActuelZogbo}
                      </td>
                      <td className="col-qty">
                        <input
                          className="qty-input"
                          inputMode="numeric"
                          aria-label={`Compté ${line.name}`}
                          placeholder="—"
                          value={line.countedZogbo ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (raw === "") {
                              patchLine(line.productId, {
                                countedZogbo: null,
                              });
                              return;
                            }
                            const n = Math.max(
                              0,
                              Math.round(Number(raw.replace(",", ".")) || 0),
                            );
                            patchLine(line.productId, { countedZogbo: n });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        ) : (
          <table className="data-table zogbo-table">
            <thead>
              <tr>
                <th scope="col">Combo</th>
                <th scope="col" className="col-qty">
                  Solde
                </th>
                <th scope="col" className="col-qty">
                  Reçu
                  <span className="col-auto-tag">Zogbo</span>
                </th>
                <th scope="col" className="col-qty">
                  Vendu
                  <span className="col-auto-tag">via Vente</span>
                </th>
                <th scope="col" className="col-qty">
                  Stock actuel
                  <span className="col-auto-tag">solde − vendu</span>
                </th>
                <th scope="col" className="col-qty">
                  Compté
                </th>
              </tr>
            </thead>
            <tbody>
              {loading || !computed ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Chargement…
                  </td>
                </tr>
              ) : computed.lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Aucun combo dans Paramètres.
                  </td>
                </tr>
              ) : (
                computed.lines.map((line) => {
                  const hasVariance =
                    line.varianceGbegamey !== null &&
                    line.varianceGbegamey !== 0;
                  return (
                    <tr
                      key={line.productId}
                      className={hasVariance ? "row-warn" : undefined}
                    >
                      <td className="cell-name">
                        {line.name}
                        <span className="cell-sub mono">
                          PU {formatFcfa(line.unitPrice)}
                        </span>
                      </td>
                      <td className="col-qty mono cell-readonly cell-auto">
                        {line.availableGbegamey}
                      </td>
                      <td className="col-qty mono cell-readonly cell-auto">
                        {line.receivedGbegamey}
                      </td>
                      <td className="col-qty mono cell-readonly cell-auto">
                        {line.soldGbegamey}
                      </td>
                      <td className="col-qty mono cell-readonly stock-actuel">
                        {line.stockActuelGbegamey}
                      </td>
                      <td className="col-qty">
                        <input
                          className="qty-input"
                          inputMode="numeric"
                          aria-label={`Compté ${line.name}`}
                          placeholder="—"
                          value={line.countedGbegamey ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (raw === "") {
                              patchLine(line.productId, {
                                countedGbegamey: null,
                              });
                              return;
                            }
                            const n = Math.max(
                              0,
                              Math.round(Number(raw.replace(",", ".")) || 0),
                            );
                            patchLine(line.productId, { countedGbegamey: n });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </section>

      <RegistreDrawer
        open={registreOpen}
        onClose={() => setRegistreOpen(false)}
        title="Registre Combos"
        subtitle={`${siteLabel} · montants en FCFA`}
      >
        {site === "zogbo" ? (
          <section className="drawer-section">
            <h3 className="panel-title">Préparations & envois</h3>
            <p className="section-hint">
              Chaque préparation et envoi vers Gbégamey est tracé ici.
            </p>
            <table className="data-table zogbo-table zogbo-registre-table">
              <thead>
                <tr>
                  <th scope="col">Heure</th>
                  <th scope="col">Type</th>
                  <th scope="col">Combo</th>
                  <th scope="col" className="col-qty">
                    Qté
                  </th>
                  <th scope="col" className="col-qty">
                    Dispo après
                  </th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {!computed || computed.movements.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      Aucun mouvement pour l’instant.
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
                            {movementTypeLabelCombos(m.type)}
                          </span>
                        </td>
                        <td className="cell-name">{m.name}</td>
                        <td className="col-qty mono">
                          {m.type === "prepare" ? "+" : "→"}
                          {m.qty}
                        </td>
                        <td className="col-qty mono cell-readonly">
                          {cancelled ? "—" : m.stockAfter}
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
        ) : null}

        <section className="drawer-section">
          <h3 className="panel-title">Sorties (ventes {siteLabel})</h3>
          <p className="section-hint">
            Ventes du point. Annulation depuis Vente ou le Registre global.
          </p>
          <table className="data-table zogbo-table zogbo-registre-table">
            <thead>
              <tr>
                <th scope="col">Heure</th>
                <th scope="col">Type</th>
                <th scope="col">Combo</th>
                <th scope="col" className="col-qty">
                  Qté
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
                    Aucune vente combo pour l’instant.
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
                      {Math.abs(e.qty)}
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
