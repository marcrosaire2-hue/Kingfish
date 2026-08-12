"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import { ProductIcon } from "@/components/product-icon";
import { RegistreDrawer } from "@/components/registre-drawer";
import { QtyInput } from "@/components/qty-input";
import { ZoneBoissonsPanel } from "@/components/zone/zone-boissons-panel";
import { ZoneCombosPanel } from "@/components/zone/zone-combos-panel";
import { ZoneVentesPanel } from "@/components/zone/zone-ventes-panel";
import { formatFcfa, formatUpdatedAt } from "@/lib/format";
import { exportZogboExcel } from "@/lib/page-exports";
import type {
  BaseDish,
  VenteLogEntry,
  VentesDaySummary,
  ZogboDay,
  ZogboLine,
  ZogboMovement,
} from "@/lib/types";
import {
  computeZogboDay,
  createEmptyZogboDay,
  formatDisplayDate,
  movementTypeLabel,
  todayIsoDate,
} from "@/lib/zogbo-calc";

type Payload = {
  day: ZogboDay;
  baseDishes: BaseDish[];
  caJournal?: number;
  lastSaleDate?: string | null;
  ventes?: VenteLogEntry[];
  ventesSummary?: VentesDaySummary;
};
type TabKey = "inventaire" | "combos" | "boissons" | "ventes";

function parseTab(raw: string | null): TabKey {
  if (raw === "combos" || raw === "boissons" || raw === "ventes") return raw;
  return "inventaire";
}

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

export function ZogboPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = parseTab(searchParams.get("tab"));
  const dateFromUrl = searchParams.get("date");
  const [date, setDate] = useState(() => {
    if (dateFromUrl && /^\d{4}-\d{2}-\d{2}$/.test(dateFromUrl)) {
      return dateFromUrl;
    }
    return todayIsoDate();
  });
  const [day, setDay] = useState<ZogboDay | null>(null);
  const [baseDishes, setBaseDishes] = useState<BaseDish[]>([]);
  const [caJournal, setCaJournal] = useState(0);
  const [lastSaleDate, setLastSaleDate] = useState<string | null>(null);
  const [ventes, setVentes] = useState<VenteLogEntry[]>([]);
  const [ventesSummary, setVentesSummary] = useState<VentesDaySummary | null>(
    null,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftPrepare, setDraftPrepare] = useState<Record<string, string>>({});
  const [draftSend, setDraftSend] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [registreOpen, setRegistreOpen] = useState(false);

  function handleDateChange(next: string) {
    if (
      dirty &&
      tab === "inventaire" &&
      !window.confirm("Modifications non enregistrées. Changer de jour ?")
    ) {
      return;
    }
    setDate(next);
  }

  function setTab(next: TabKey) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "inventaire") params.delete("tab");
    else params.set("tab", next);
    const q = params.toString();
    router.replace(q ? `/zogbo?${q}` : "/zogbo");
  }

  async function loadDay(nextDate = date) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/zogbo?date=${encodeURIComponent(nextDate)}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setDay(body.day);
      setBaseDishes(body.baseDishes);
      setCaJournal(Number(body.caJournal) || 0);
      setLastSaleDate(body.lastSaleDate ?? null);
      setVentes(body.ventes ?? []);
      setVentesSummary(body.ventesSummary ?? null);
      setDirty(false);
      setDraftPrepare({});
      setDraftSend({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setDay(createEmptyZogboDay(nextDate, []));
      setBaseDishes([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDay(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on date only
  }, [date]);

  const computed = useMemo(() => {
    if (!day) return null;
    return computeZogboDay(day, baseDishes);
  }, [day, baseDishes]);

  function patchLine(productId: string, patch: Partial<ZogboLine>) {
    if (!day) return;
    setDay({
      ...day,
      lines: day.lines.map((l) =>
        l.productId === productId ? { ...l, ...patch } : l,
      ),
    });
    setDirty(true);
  }

  async function handleSaveMeta() {
    if (!day) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/zogbo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: day.date,
          status: day.status,
          lines: day.lines,
        }),
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur d’enregistrement");
      setDay(body.day);
      setBaseDishes(body.baseDishes);
      setDirty(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d’enregistrement");
    } finally {
      setSaving(false);
    }
  }

  async function cancelMovement(m: ZogboMovement) {
    const label = `${movementTypeLabel(m.type)} · ${m.qty} × ${m.name}`;
    if (!window.confirm(`Annuler ce mouvement ?\n\n${label}`)) return;
    setBusyId(`cancel-${m.id}`);
    setError(null);
    try {
      const res = await fetch("/api/zogbo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", date, movementId: m.id }),
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Annulation impossible");
      setDay(body.day);
      setBaseDishes(body.baseDishes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible");
    } finally {
      setBusyId(null);
    }
  }

  async function submitMovement(
    productId: string,
    type: "prepare" | "send",
    raw: string,
  ) {
    const qty = Math.round(Number(raw.replace(",", ".")) || 0);
    if (qty <= 0) return;
    setBusyId(`${productId}-${type}`);
    setError(null);
    try {
      const res = await fetch("/api/zogbo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, productId, type, qty }),
      });
      const body = (await res.json()) as Payload & {
        movement?: ZogboMovement;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setBaseDishes(body.baseDishes);
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

  const platsCount = computed?.lines.length ?? baseDishes.length;
  const journalLignes = ventesSummary?.lignes ?? 0;
  const counterSold = computed?.totals.sold ?? 0;
  const movementCount = computed?.movements.length ?? 0;
  const journalOnlyDay =
    !loading &&
    journalLignes > 0 &&
    counterSold === 0 &&
    movementCount === 0 &&
    (computed?.totals.prepared ?? 0) === 0;

  return (
    <AppShell
      title="Zogbo"
      subtitle="Préparer, envoyer, vendre. Stock actuel = dispo − ventes. Montants en FCFA."
    >
      <ContextBar date={date} onDateChange={handleDateChange}>
        <ExportExcelButton
          onExport={() => exportZogboExcel(date)}
          disabled={loading}
        />
        {tab === "inventaire" ? (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setRegistreOpen(true)}
            >
              Registre
            </button>
            <button
              type="button"
              className={`btn btn-primary${savedFlash && !dirty ? " btn-saved" : ""}`}
              onClick={handleSaveMeta}
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
          </>
        ) : null}
      </ContextBar>

      <div className="section-tabs zogbo-cats" role="tablist" aria-label="Sections Zogbo">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "inventaire"}
          className={`section-tab${tab === "inventaire" ? " is-active" : ""}`}
          onClick={() => setTab("inventaire")}
        >
          Plats
          <span className="section-count">{platsCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "combos"}
          className={`section-tab${tab === "combos" ? " is-active" : ""}`}
          onClick={() => setTab("combos")}
        >
          Combos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "boissons"}
          className={`section-tab${tab === "boissons" ? " is-active" : ""}`}
          onClick={() => setTab("boissons")}
        >
          Boissons
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "ventes"}
          className={`section-tab${tab === "ventes" ? " is-active" : ""}`}
          onClick={() => setTab("ventes")}
        >
          Ventes
          {journalLignes > 0 ? (
            <span className="section-count">{journalLignes}</span>
          ) : null}
        </button>
      </div>

      {tab === "combos" ? <ZoneCombosPanel date={date} site="zogbo" /> : null}
      {tab === "boissons" ? (
        <ZoneBoissonsPanel date={date} site="zogbo" />
      ) : null}
      {tab === "ventes" ? (
        <ZoneVentesPanel
          date={date}
          ventes={ventes}
          summary={ventesSummary}
          loading={loading}
        />
      ) : null}

      {tab === "inventaire" ? (
        <>
          <div className="param-meta zogbo-meta">
            <p>
              <strong>{formatDisplayDate(date)}</strong>
              {" · "}
              Dernière sauvegarde :{" "}
              <strong>
                {loading ? "…" : formatUpdatedAt(day?.updatedAt ?? null)}
              </strong>
            </p>
            {computed && computed.totals.varianceCount > 0 ? (
              <p className="warn-inline">
                {computed.totals.varianceCount} écart
                {computed.totals.varianceCount > 1 ? "s" : ""} détecté
                {computed.totals.varianceCount > 1 ? "s" : ""}
              </p>
            ) : null}
          </div>

          {error ? (
            <p className="error-banner" role="alert">
              {error}
            </p>
          ) : null}

          {!loading &&
          caJournal <= 0 &&
          lastSaleDate &&
          lastSaleDate !== date ? (
            <p className="ui-info" role="status">
              <span className="ui-info-mark" aria-hidden>
                i
              </span>
              Aucune vente enregistrée pour{" "}
              <strong>{formatDisplayDate(date)}</strong>. Dernières ventes
              Zogbo :{" "}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => handleDateChange(lastSaleDate)}
              >
                {formatDisplayDate(lastSaleDate)}
              </button>
            </p>
          ) : null}

          {journalOnlyDay ? (
            <p className="warn-inline" role="status">
              {journalLignes} ligne{journalLignes > 1 ? "s" : ""} de vente dans
              le journal ({formatFcfa(caJournal)}) sans stock ni mouvement sur
              les plats — détail dans l’onglet{" "}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setTab("ventes")}
              >
                Ventes
              </button>
              .
            </p>
          ) : null}

          {computed ? (
            <div className="zogbo-stats">
              <div className="zogbo-stat zogbo-stat-ca">
                <span className="zogbo-stat-icon" aria-hidden>
                  F
                </span>
                <div>
                  <span className="stat-label">CA journal (FCFA)</span>
                  <span className="zogbo-stat-value mono">
                    {formatFcfa(caJournal)}
                  </span>
                  {journalLignes > 0 ? (
                    <span className="cell-sub">
                      {journalLignes} ligne{journalLignes > 1 ? "s" : ""} ·{" "}
                      {ventesSummary?.articles ?? 0} art.
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="zogbo-stat">
                <span className="zogbo-stat-icon" aria-hidden>
                  #
                </span>
                <div>
                  <span className="stat-label">Transactions journal</span>
                  <span className="zogbo-stat-value mono">{journalLignes}</span>
                </div>
              </div>
              <div className="zogbo-stat">
                <span className="zogbo-stat-icon" aria-hidden>
                  ▦
                </span>
                <div>
                  <span className="stat-label">Dispo (préparé − envoyé)</span>
                  <span className="zogbo-stat-value mono">
                    {computed.totals.stock}
                  </span>
                </div>
              </div>
              <div className="zogbo-stat">
                <span className="zogbo-stat-icon" aria-hidden>
                  +
                </span>
                <div>
                  <span className="stat-label">Préparé (jour)</span>
                  <span className="zogbo-stat-value mono">
                    {computed.totals.prepared}
                  </span>
                </div>
              </div>
              <div className="zogbo-stat">
                <span className="zogbo-stat-icon" aria-hidden>
                  →
                </span>
                <div>
                  <span className="stat-label">Envoyé Gbégamey</span>
                  <span className="zogbo-stat-value mono">
                    {computed.totals.sent}
                  </span>
                </div>
              </div>
              <div className="zogbo-stat">
                <span className="zogbo-stat-icon" aria-hidden>
                  V
                </span>
                <div>
                  <span className="stat-label">Vendu</span>
                  <span className="zogbo-stat-value mono">
                    {computed.totals.sold}
                  </span>
                </div>
              </div>
              <div className="zogbo-stat zogbo-stat-main">
                <span className="zogbo-stat-icon" aria-hidden>
                  ✓
                </span>
                <div>
                  <span className="stat-label">Stock actuel</span>
                  <span className="zogbo-stat-value mono">
                    {computed.totals.theoretical}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          <div className="ui-info" role="note">
            <span className="ui-info-mark" aria-hidden>
              i
            </span>
            <p>
              <strong>Plats</strong> : stock et mouvements (préparé, envoyé).
              Les ventes encaissées sont dans le{" "}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setTab("ventes")}
              >
                journal Ventes
              </button>
              . Le CA du jour en est la somme.
            </p>
          </div>

          <section className="panel panel-wide zogbo-panel">
            <table className="data-table zogbo-table">
              <thead>
                <tr>
                  <th scope="col">Plat</th>
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
                      Aucun plat de base dans Paramètres.
                    </td>
                  </tr>
                ) : (
                  computed.lines.map((line) => {
                    const hasVariance =
                      line.variance !== null && line.variance !== 0;
                    const prepBusy = busyId === `${line.productId}-prepare`;
                    const sendBusy = busyId === `${line.productId}-send`;
                    return (
                      <tr
                        key={line.productId}
                        className={hasVariance ? "row-warn" : undefined}
                      >
                        <td className="cell-name">
                          <span className="zogbo-plat-cell">
                            <ProductIcon
                              kind="plat"
                              name={line.name}
                              size="sm"
                            />
                            <span>
                              {line.name}
                              <span className="cell-sub mono">
                                {formatFcfa(line.unitPrice)}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="col-qty mono cell-readonly cell-auto">
                          {line.stock}
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
                          {line.sold}
                        </td>
                        <td className="col-qty mono cell-readonly stock-actuel">
                          {line.theoreticalRemaining}
                        </td>
                        <td className="col-qty">
                          <QtyInput
                            value={line.counted}
                            allowEmpty
                            placeholder="—"
                            ariaLabel={`Compté ${line.name}`}
                            onChange={(counted) =>
                              patchLine(line.productId, { counted })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {computed && computed.lines.length > 0 ? (
                <tfoot>
                  <tr>
                    <th scope="row">TOTAL</th>
                    <td className="mono">{computed.totals.stock}</td>
                    <td className="mono">{computed.totals.prepared}</td>
                    <td className="mono">{computed.totals.sent}</td>
                    <td className="mono">{computed.totals.sold}</td>
                    <td className="mono">{computed.totals.theoretical}</td>
                    <td className="mono">{computed.totals.counted}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </section>

          <RegistreDrawer
            open={registreOpen}
            onClose={() => setRegistreOpen(false)}
            title="Registre du jour"
            subtitle="Mouvements préparés et envoyés — annulables"
          >
            <table className="data-table zogbo-table zogbo-registre-table">
              <thead>
                <tr>
                  <th scope="col">Heure</th>
                  <th scope="col">Type</th>
                  <th scope="col">Plat</th>
                  <th scope="col" className="col-qty">
                    Qté
                  </th>
                  <th scope="col" className="col-qty">
                    Dispo après
                  </th>
                  <th scope="col" className="col-qty">
                    Action
                  </th>
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
                          <span
                            className={`hist-badge${m.type === "send" ? " hist-badge-transfert" : " hist-badge-zogbo"}`}
                          >
                            {movementTypeLabel(m.type)}
                          </span>
                        </td>
                        <td className="cell-name">{m.name}</td>
                        <td className="col-qty mono">
                          {m.type === "prepare" ? "+" : "−"}
                          {m.qty}
                        </td>
                        <td className="col-qty mono cell-readonly">
                          {cancelled ? "—" : m.stockAfter}
                        </td>
                        <td className="col-qty">
                          {cancelled ? (
                            <span className="muted">Annulé</span>
                          ) : (
                            <button
                              type="button"
                              className="btn-link"
                              disabled={!!busyId}
                              onClick={() => void cancelMovement(m)}
                            >
                              {busyId === `cancel-${m.id}`
                                ? "…"
                                : "Annuler"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </RegistreDrawer>
        </>
      ) : null}
    </AppShell>
  );
}
