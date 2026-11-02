"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RegistreDrawer } from "@/components/registre-drawer";
import { ExportExcelButton } from "@/components/export-excel-button";
import { downloadExcel, excelFilename } from "@/lib/export-excel";
import {
  computeBoissonsDay,
  createEmptyBoissonsDay,
  DEFAULT_UNITS_PER_CASIER,
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
import { ProductIcon } from "@/components/product-icon";
import { EcartBadge } from "@/components/stock-ecart";

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
  premium = false,
  readOnly = false,
}: {
  date: string;
  site: VenteSite;
  /** Style aligné sur Stock Zogbo / Catalogue (onglet Boissons). */
  premium?: boolean;
  /** Consultation sans saisie (DAF). */
  readOnly?: boolean;
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
  /** Compteur de saisies : une réponse d'enregistrement plus ancienne que la
   *  dernière frappe ne doit pas écraser ce qui vient d'être tapé. */
  const editSeq = useRef(0);
  /** Saisie dont l'enregistrement a échoué : pas de relance auto en boucle. */
  const failedSeq = useRef(-1);

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
    if (readOnly) return;
    if (!day) return;
    setDay({
      ...day,
      lines: day.lines.map((l) =>
        l.productId === productId ? { ...l, ...patch } : l,
      ),
    });
    editSeq.current += 1;
    setDirty(true);
  }

  async function handleSave() {
    if (readOnly || !day) return;
    const seq = editSeq.current;
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
      setDrinks(body.drinks);
      // Saisie faite pendant l'envoi : on la garde, l'enregistrement auto
      // repartira avec la nouvelle valeur.
      if (editSeq.current !== seq) return;
      setDay(body.day);
      setDirty(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      failedSeq.current = seq;
      setError(e instanceof Error ? e.message : "Erreur d’enregistrement");
    } finally {
      setSaving(false);
    }
  }

  // Zogbo : comptage enregistré dès la saisie, la correction du stock réel
  // est immédiate. Court délai pour ne pas enregistrer « 2 » quand on tape
  // « 24 ». Gbégamey garde l'enregistrement par le bouton.
  useEffect(() => {
    if (site !== "zogbo" || !dirty || readOnly || saving) return;
    if (failedSeq.current === editSeq.current) return;
    const t = window.setTimeout(() => void handleSave(), 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, dirty, saving, readOnly, site]);

  function openPurchase(productId: string, raw: string) {
    if (readOnly) return;
    const bt = Math.round(Number(raw.replace(",", ".")) || 0);
    if (bt <= 0) {
      setError("Indiquez d’abord la quantité en bouteilles.");
      return;
    }
    setError(null);
    void submitPurchase(productId, raw);
  }

  async function submitPurchase(productId: string, raw: string) {
    if (readOnly) return;
    const upc = Math.max(
      1,
      Math.round(
        drinks.find((d) => d.id === productId)?.unitsPerCasier ||
          DEFAULT_UNITS_PER_CASIER,
      ),
    );
    const bt = Math.round(Number(raw.replace(",", ".")) || 0);
    if (bt <= 0) return;
    // Saisie en bouteilles → stock interne en casiers (29 bt = 2,42 casiers).
    const qty = Math.round((bt / upc) * 100) / 100;
    setBusyId(`buy-${productId}`);
    setError(null);
    try {
      const res = await fetch("/api/boissons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          productId,
          qty,
          qtyBottles: bt,
          site,
          // QR retiré de l'app : le serveur en génère par défaut, on le refuse.
          generateQr: false,
        }),
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
    const upc = Math.max(
      1,
      Math.round(
        drinks.find((d) => d.id === m.productId)?.unitsPerCasier ||
          DEFAULT_UNITS_PER_CASIER,
      ),
    );
    if (
      !window.confirm(
        `Annuler cet achat ?\n\n+${Math.round(m.qty * upc)} bouteille(s) × ${m.name}`,
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
      const body = (await res.json()) as Payload & {
        error?: string;
        voidedQr?: number;
      };
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
  const upcOf = (productId: string) =>
    Math.max(
      1,
      Math.round(
        drinks.find((d) => d.id === productId)?.unitsPerCasier ||
          DEFAULT_UNITS_PER_CASIER,
      ),
    );
  const qtySite = computed
    ? site === "zogbo"
      ? computed.totals.soldZogbo
      : computed.totals.soldGbegamey
    : 0;
  const siteExits = exits.filter((e) => e.site === site);
  // Achats désormais propres à chaque site : un achat fait à Gbégamey ne
  // doit ni s'afficher ni s'annuler depuis l'écran Zogbo.
  const siteMovements = computed?.movements.filter((m) => m.site === site) ?? [];
  const movementCount = siteMovements.length + siteExits.length;

  const stockActuelBt = computed
    ? computed.lines.reduce(
        (s, l) =>
          s +
          Math.max(
            0,
            Math.round(
              (site === "zogbo"
                ? l.theoreticalRemainingZogbo
                : l.theoreticalRemainingGbegamey) * l.unitsPerCasier,
            ),
          ),
        0,
      )
    : 0;

  const achatsBt = computed
    ? computed.lines.reduce(
        (s, l) =>
          s +
          Math.round(
            (site === "zogbo" ? l.purchasesZogbo : l.purchasesGbegamey) *
              l.unitsPerCasier,
          ),
        0,
      )
    : 0;

  if (premium) {
    return (
      <div className="zone-panel-premium catalogue-view">
        <div className="catalogue-view-top">
          <p className="catalogue-meta">
            <span className="catalogue-meta-icon" aria-hidden>
              ⏱
            </span>
            Boissons — <strong>{siteLabel}</strong>
            {" · "}
            Dernière sauvegarde :{" "}
            <strong>
              {loading ? "…" : formatUpdatedAt(day?.updatedAt ?? null)}
            </strong>
          </p>
          <div className="catalogue-view-top-actions">
            <div className="catalogue-view-actions">
              <ExportExcelButton
                disabled={loading || !computed || computed.lines.length === 0}
                className="btn btn-ghost"
                onExport={() => {
                  if (!computed) return Promise.resolve();
                  downloadExcel(excelFilename("stock-boissons", site, date), [
                    {
                      name: "Boissons",
                      subtitle: `${siteLabel} · ${date}`,
                      rows: computed.lines.map((line) => {
                        const upc = line.unitsPerCasier;
                        const zog = site === "zogbo";
                        const theo = Math.max(
                          0,
                          Math.round(
                            (zog
                              ? line.theoreticalRemainingZogbo
                              : line.theoreticalRemainingGbegamey) * upc,
                          ),
                        );
                        const counted = zog
                          ? line.countedZogbo
                          : line.countedGbegamey;
                        return {
                          Boisson: line.name,
                          "Achat (bt)": Math.round(
                            (zog ? line.purchasesZogbo : line.purchasesGbegamey) *
                              upc,
                          ),
                          "Stock réel (bt)": counted ?? "",
                          "Stock théorique (bt)": theo,
                          "Stock restant (bt)": counted ?? theo,
                          "Écart (bt)": counted === null ? "" : counted - theo,
                          "Vendu (bt)": zog ? line.soldZogbo : line.soldGbegamey,
                        };
                      }),
                    },
                  ]);
                  return Promise.resolve();
                }}
              />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setRegistreOpen(true)}
              >
                Registre · {movementCount}
              </button>
              {readOnly ? null : (
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
                        ? "Enregistrer"
                        : "À jour"}
                </button>
              )}
            </div>
          </div>
        </div>

        {error ? (
          <div className="catalogue-alert catalogue-alert-danger" role="alert">
            <span className="catalogue-alert-icon" aria-hidden>
              !
            </span>
            <span>{error}</span>
          </div>
        ) : null}

        <div className="catalogue-info" role="note">
          <span className="catalogue-info-mark" aria-hidden>
            i
          </span>
          <p>
            Un seul geste : saisissez le nombre de <strong>bouteilles</strong>{" "}
            achetées. Ça met le stock à jour.
          </p>
        </div>

        {computed && computed.totals.missingSalePrice > 0 ? (
          <div className="catalogue-alert catalogue-alert-danger" role="alert">
            <span className="catalogue-alert-icon" aria-hidden>
              !
            </span>
            <span>
              <strong>
                {computed.totals.missingSalePrice} boisson
                {computed.totals.missingSalePrice > 1 ? "s" : ""} sans prix de
                vente
              </strong>{" "}
              — carte grisée en caisse tant que le PV n&apos;est pas renseigné
              dans le Catalogue.
            </span>
          </div>
        ) : null}

        <div className="catalogue-kpi-grid" aria-label="Totaux boissons">
          <div className="catalogue-kpi">
            <span className="catalogue-kpi-label">Stock actuel (bt)</span>
            <strong className="catalogue-kpi-value">{stockActuelBt}</strong>
          </div>
          <div className="catalogue-kpi">
            <span className="catalogue-kpi-label">Achats (bt)</span>
            <strong className="catalogue-kpi-value">{achatsBt}</strong>
          </div>
          <div className="catalogue-kpi">
            <span className="catalogue-kpi-label">Vendu (bt)</span>
            <strong className="catalogue-kpi-value">{qtySite}</strong>
          </div>
          <div className="catalogue-kpi catalogue-kpi-accent">
            <span className="catalogue-kpi-label">CA journal</span>
            <strong className="catalogue-kpi-value catalogue-kpi-fcfa">
              {formatFcfa(caJournal)}
            </strong>
          </div>
        </div>

        <section className="catalogue-panel">
          <div className="catalogue-table-wrap">
            <table className="catalogue-table stock-zogbo-table">
              <thead>
                <tr className="stock-grp">
                  <th aria-hidden="true"></th>
                  <th colSpan={2} className="is-input">
                    À saisir
                  </th>
                  <th colSpan={4}>Calculé</th>
                </tr>
                <tr>
                  <th scope="col">Boisson</th>
                  <th scope="col">Quantité achetée (bt)</th>
                  <th scope="col">Stock réel (bt)</th>
                  <th scope="col">Stock théorique (bt)</th>
                  <th scope="col">Stock restant (bt)</th>
                  <th scope="col">Écart (bt)</th>
                  <th scope="col">Vendu {siteLabel} (bt)</th>
                </tr>
              </thead>
              <tbody>
                {loading || !computed ? (
                  <tr>
                    <td colSpan={7}>
                      <BrandLoader variant="ligne" label="Chargement…" />
                    </td>
                  </tr>
                ) : computed.lines.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="catalogue-empty">
                        <p className="catalogue-empty-title">
                          Aucune boisson
                        </p>
                        <p className="catalogue-empty-hint">
                          Ajoutez des boissons dans le Catalogue.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  computed.lines.map((line) => {
                    const upc = line.unitsPerCasier;
                    const qty =
                      site === "zogbo" ? line.soldZogbo : line.soldGbegamey;
                    const initialStock =
                      site === "zogbo"
                        ? line.initialStockZogbo
                        : line.initialStockGbegamey;
                    const purchases =
                      site === "zogbo"
                        ? line.purchasesZogbo
                        : line.purchasesGbegamey;
                    const available =
                      site === "zogbo"
                        ? line.availableZogbo
                        : line.availableGbegamey;
                    const theoreticalRemaining =
                      site === "zogbo"
                        ? line.theoreticalRemainingZogbo
                        : line.theoreticalRemainingGbegamey;
                    const counted =
                      site === "zogbo"
                        ? line.countedZogbo
                        : line.countedGbegamey;
                    const theoBt = Math.max(
                      0,
                      Math.round(theoreticalRemaining * upc),
                    );
                    const restantBt = counted ?? theoBt;
                    const ecart = counted === null ? null : counted - theoBt;
                    const missingPv = line.salePrice === null;
                    const buyBusy = busyId === `buy-${line.productId}`;
                    return (
                      <tr
                        key={line.productId}
                        className={missingPv ? "row-warn" : undefined}
                      >
                        <td>
                          <div className="catalogue-product-cell">
                            <ProductIcon
                              kind="boisson"
                              name={line.name}
                              size="md"
                            />
                            <div>
                              <div className="catalogue-product-name">
                                {line.name}
                              </div>
                              <span className="cell-sub mono">
                                init. {Math.round(initialStock * upc)} bt ·
                                achats {Math.round(purchases * upc)} bt · solde{" "}
                                {Math.round(available * upc)} bt
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="stock-prepared-cell">
                            <span className="catalogue-qty-badge">
                              {Math.round(purchases * upc)}
                            </span>
                            {readOnly ? null : (
                              <div className="mvt-entry catalogue-inline-qr">
                                <input
                                  className="qty-input"
                                  inputMode="numeric"
                                  aria-label={`Achat bouteilles ${line.name}`}
                                  placeholder="+"
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
                                      openPurchase(
                                        line.productId,
                                        draftBuy[line.productId] ?? "",
                                      );
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  disabled={buyBusy || !!busyId}
                                  aria-label={`Acheter ${line.name}`}
                                  onClick={() =>
                                    openPurchase(
                                      line.productId,
                                      draftBuy[line.productId] ?? "",
                                    )
                                  }
                                >
                                  {buyBusy ? "…" : "+"}
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                        <td>
                          {readOnly ? (
                            <span className="catalogue-qty-badge">
                              {counted ?? (site === "zogbo" ? 0 : "—")}
                            </span>
                          ) : (
                            <input
                              className="qty-input"
                              inputMode="numeric"
                              aria-label={`Stock réel bouteilles ${line.name}`}
                              placeholder={site === "zogbo" ? "0" : String(theoBt)}
                              value={counted ?? ""}
                              onChange={(e) => {
                                const raw = e.target.value
                                  .trim()
                                  .replace(",", ".");
                                const n =
                                  raw === ""
                                    ? null
                                    : Math.max(0, Math.round(Number(raw) || 0));
                                patchLine(
                                  line.productId,
                                  site === "zogbo"
                                    ? { countedZogbo: n }
                                    : { countedGbegamey: n },
                                );
                              }}
                            />
                          )}
                        </td>
                        <td>
                          <span className="catalogue-qty-badge">{theoBt}</span>
                        </td>
                        <td>
                          <span
                            className={`catalogue-qty-badge catalogue-qty-badge-accent stock-remaining-badge${
                              restantBt <= 0 ? " is-empty" : ""
                            }`}
                          >
                            {restantBt}
                          </span>
                        </td>
                        <td>
                          <EcartBadge value={ecart} />
                        </td>
                        <td>
                          <span className="catalogue-qty-badge">{qty}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <RegistreDrawer
          open={registreOpen}
          onClose={() => setRegistreOpen(false)}
          title="Registre Boissons"
          subtitle={`${siteLabel} · achats et ventes en bouteilles`}
        >
          {renderRegistreContent()}
        </RegistreDrawer>
      </div>
    );
  }

  function renderRegistreContent() {
    return (
      <>
        <section className="drawer-section">
          <h3 className="panel-title">Entrées (achats)</h3>
          <p className="section-hint">
            Chaque achat est saisi en bouteilles, tracé ici, et peut être
            annulé tant que le stock le permet.
          </p>
          <table className="data-table zogbo-table zogbo-registre-table">
            <thead>
              <tr>
                <th scope="col">Heure</th>
                <th scope="col">Type</th>
                <th scope="col">Boisson</th>
                <th scope="col" className="col-qty">
                  Bouteilles
                </th>
                <th scope="col" className="col-qty">
                  Dispo après (bt)
                </th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {siteMovements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Aucun achat pour l’instant.
                  </td>
                </tr>
              ) : (
                siteMovements.map((m) => {
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
                      <td className="col-qty mono">
                        +{Math.round(m.qty * upcOf(m.productId))} bt
                      </td>
                      <td className="col-qty mono cell-readonly">
                        {cancelled
                          ? "—"
                          : `${Math.round(m.stockAfter * upcOf(m.productId))} bt`}
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
      </>
    );
  }

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
        {readOnly ? null : (
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
        )}
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
          Un seul geste : saisissez le nombre de <strong>bouteilles</strong>{" "}
          achetées. Ça met le stock à jour.
        </p>
      </div>

      {computed && computed.totals.missingSalePrice > 0 ? (
        <p className="warn-inline">
          {computed.totals.missingSalePrice} sans prix de vente
        </p>
      ) : null}

      <div className="stat-row">
        <div className="stat-chip">
          <span className="stat-label">Stock actuel {siteLabel} (bt)</span>
          <span className="stat-value mono">
            {computed
              ? computed.lines.reduce(
                  (s, l) =>
                    s +
                    Math.max(
                      0,
                      Math.round(
                        (site === "zogbo"
                          ? l.theoreticalRemainingZogbo
                          : l.theoreticalRemainingGbegamey) * l.unitsPerCasier,
                      ),
                    ),
                  0,
                )
              : 0}
          </span>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Achats {siteLabel} (bt)</span>
          <span className="stat-value mono">
            {computed
              ? computed.lines.reduce(
                  (s, l) =>
                    s +
                    Math.round(
                      (site === "zogbo" ? l.purchasesZogbo : l.purchasesGbegamey) *
                        l.unitsPerCasier,
                    ),
                  0,
                )
              : 0}
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
                <span className="col-auto-tag">bouteilles</span>
              </th>
              <th scope="col" className="col-qty">
                Vendu {siteLabel}
                <span className="col-auto-tag">bouteilles</span>
              </th>
              <th scope="col" className="col-qty">
                Stock actuel
                <span className="col-auto-tag">saisie = comptage (bt)</span>
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
                const initialStock =
                  site === "zogbo"
                    ? line.initialStockZogbo
                    : line.initialStockGbegamey;
                const purchases =
                  site === "zogbo" ? line.purchasesZogbo : line.purchasesGbegamey;
                const available =
                  site === "zogbo" ? line.availableZogbo : line.availableGbegamey;
                const theoreticalRemaining =
                  site === "zogbo"
                    ? line.theoreticalRemainingZogbo
                    : line.theoreticalRemainingGbegamey;
                const counted =
                  site === "zogbo" ? line.countedZogbo : line.countedGbegamey;
                const variance =
                  site === "zogbo" ? line.varianceZogbo : line.varianceGbegamey;
                const hasVariance = variance !== null && variance !== 0;
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
                        init. {Math.round(initialStock * line.unitsPerCasier)}{" "}
                        bt · achats{" "}
                        {Math.round(purchases * line.unitsPerCasier)} bt ·
                        solde {Math.round(available * line.unitsPerCasier)}{" "}
                        bt
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
                      {readOnly ? (
                        <span className="mono">
                          {Math.round(purchases * line.unitsPerCasier)}
                        </span>
                      ) : (
                        <div className="mvt-entry">
                          <input
                            className="qty-input"
                            inputMode="numeric"
                            aria-label={`Achat bouteilles ${line.name}`}
                            placeholder="bt"
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
                                openPurchase(
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
                            aria-label={`Acheter ${line.name}`}
                            onClick={() =>
                              openPurchase(
                                line.productId,
                                draftBuy[line.productId] ?? "",
                              )
                            }
                          >
                            {buyBusy ? "…" : "+"}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="col-qty mono cell-readonly cell-auto">
                      {qty}
                      <span className="cell-sub">bt</span>
                    </td>
                    <td className="col-qty">
                      {readOnly ? (
                        <span className="mono">{counted ?? (site === "zogbo" ? 0 : "—")}</span>
                      ) : (
                        <input
                          className="qty-input"
                          inputMode="numeric"
                          aria-label={`Stock actuel bouteilles ${line.name}`}
                          placeholder={
                            site === "zogbo"
                              ? "0"
                              : String(
                                  Math.max(
                                    0,
                                    Math.round(theoreticalRemaining * line.unitsPerCasier),
                                  ),
                                )
                          }
                          value={counted ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value.trim().replace(",", ".");
                            const n =
                              raw === ""
                                ? null
                                : Math.max(0, Math.round(Number(raw) || 0));
                            patchLine(
                              line.productId,
                              site === "zogbo"
                                ? { countedZogbo: n }
                                : { countedGbegamey: n },
                            );
                          }}
                        />
                      )}
                      {counted !== null ? (
                        <span className="cell-sub muted">
                          théo.{" "}
                          {Math.max(
                            0,
                            Math.round(
                              theoreticalRemaining * line.unitsPerCasier,
                            ),
                          )}{" "}
                          bt
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
        subtitle={`${siteLabel} · achats et ventes en bouteilles`}
      >
        {renderRegistreContent()}
      </RegistreDrawer>
    </div>
  );
}
