"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import {
  downloadExcel,
  excelFilename,
} from "@/lib/export-excel";
import { formatFcfa } from "@/lib/format";
import { computeMatieresDay } from "@/lib/matieres-calc";
import type {
  CaisseKey,
  CaisseMouvement,
  Fournisseur,
  MatieresDay,
  MatieresMovement,
  RawMaterial,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import { CAISSE_LABELS, CAISSE_SHORT_LABELS } from "@/lib/caisse-model";
import { BrandLoader } from "@/components/brand-loader";

type TabKey = "depenses" | "stock";

type DepenseRow = {
  sessionId: string;
  sessionDate: string;
  sessionUserName: string | null;
  mouvement: CaisseMouvement;
};

type AchatsPayload = {
  date: string;
  caisse: CaisseKey;
  depenses: DepenseRow[];
  total: number;
  caisseOpen: boolean;
  activeDate: string | null;
  allowedCaisses: CaisseKey[];
  defaultCaisse: CaisseKey;
};

type StockPayload = {
  day: MatieresDay;
  materials: RawMaterial[];
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

export function AchatsPage() {
  const [tab, setTab] = useState<TabKey>("depenses");
  const [date, setDate] = useState(() => todayIsoDate());
  const [caisse, setCaisse] = useState<CaisseKey>("zogbo");
  const [allowed, setAllowed] = useState<CaisseKey[]>([]);
  const [data, setData] = useState<AchatsPayload | null>(null);
  const [caisseOpen, setCaisseOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Saisie d'une dépense
  const [nature, setNature] = useState("");
  const [beneficiaire, setBeneficiaire] = useState("");
  const [montant, setMontant] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // Onglet Stock (ancienne page Appro) : entrées de stock matières.
  const [day, setDay] = useState<MatieresDay | null>(null);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [draftBuy, setDraftBuy] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [fournisseurId, setFournisseurId] = useState("");

  // Ouverture directe de l'onglet Stock (ex. depuis Contrôle).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "stock") {
      const timer = window.setTimeout(() => setTab("stock"), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  async function loadDepenses(nextCaisse: CaisseKey, nextDate: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/achats?caisse=${encodeURIComponent(nextCaisse)}&date=${encodeURIComponent(nextDate)}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as AchatsPayload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setData(body);
      setCaisse(body.caisse);
      setCaisseOpen(body.caisseOpen);
      setAllowed(body.allowedCaisses ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDepenses(caisse, date), 0);
    return () => window.clearTimeout(timer);
  }, [caisse, date]);

  async function loadStock(nextDate = date) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/matieres?date=${encodeURIComponent(nextDate)}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as StockPayload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setMaterials(body.materials);
      setDraftBuy({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setDay(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let timer = 0;
    if (tab === "stock") {
      timer = window.setTimeout(() => void loadStock(date), 0);
    }
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, date]);

  // Fournisseurs proposés à la saisie : gérés dans Réglages.
  useEffect(() => {
    let annule = false;
    void (async () => {
      try {
        const res = await fetch("/api/pos-config", { cache: "no-store" });
        if (!res.ok) return;
        const config = (await res.json()) as { fournisseurs?: Fournisseur[] };
        if (!annule) setFournisseurs(config.fournisseurs ?? []);
      } catch {
        /* la saisie d'achat reste possible sans fournisseur */
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

  const computed = useMemo(() => {
    if (!day) return null;
    return computeMatieresDay(day, materials);
  }, [day, materials]);

  const totalDepenses = data?.total ?? 0;

  async function submitDepense() {
    const montantOk = Math.round(Number(montant.replace(",", "."))) || 0;
    if (montantOk <= 0 || nature.trim().length < 2) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/achats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "depense",
          caisse,
          date,
          nature: nature.trim(),
          beneficiaire: beneficiaire.trim() || undefined,
          montant: montantOk,
        }),
      });
      const body = (await res.json()) as (
        | AchatsPayload
        | { error?: string }
      );
      if (!res.ok) throw new Error((body as { error?: string }).error || "Erreur");
      const payload = body as AchatsPayload;
      if (payload.depenses) setData(payload);
      setNature("");
      setBeneficiaire("");
      setMontant("");
      setFlash(`${formatFcfa(montantOk)} enregistrés à la ${CAISSE_LABELS[caisse].toLowerCase()}`);
      window.setTimeout(() => setFlash(null), 2600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function submitPurchase(productId: string, raw: string) {
    const qty = Number(String(raw).replace(",", ".")) || 0;
    if (qty <= 0) return;
    setBusyId(`buy-${productId}`);
    setError(null);
    try {
      const res = await fetch("/api/matieres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          productId,
          qty,
          fournisseurId: fournisseurId || undefined,
        }),
      });
      const body = (await res.json()) as StockPayload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setMaterials(body.materials);
      setDraftBuy((d) => ({ ...d, [productId]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelMovement(m: MatieresMovement) {
    if (!window.confirm(`Annuler cet achat de stock ?\n\n+${m.qty} × ${m.name}`)) {
      return;
    }
    setBusyId(`cancel-${m.id}`);
    setError(null);
    try {
      const res = await fetch("/api/matieres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          date,
          movementId: m.id,
        }),
      });
      const body = (await res.json()) as StockPayload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setMaterials(body.materials);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell
      title="Achats"
      subtitle="Dépenses du site avec explication + entrées de stock matières"
      actions={
        <ExportExcelButton
          disabled={loading || !data}
          onExport={() => {
            if (tab === "stock") {
              if (!computed) return Promise.resolve();
              downloadExcel(excelFilename("achats-stock", date), [
                {
                  name: "Stock",
                  rows: computed.lines.map((l) => ({
                    Matière: l.name,
                    Unité: l.unit,
                    Initial: l.initialStock,
                    Achats: l.purchases,
                    Stock: l.stock,
                  })),
                },
              ]);
              return Promise.resolve();
            }
            if (!data) return Promise.resolve();
            downloadExcel(excelFilename("achats", date), [
              {
                name: "Dépenses",
                rows: data.depenses.map((d) => ({
                  Heure: formatTime(d.mouvement.at),
                  Explication: d.mouvement.nature,
                  Bénéficiaire: d.mouvement.beneficiaire || "",
                  Montant: d.mouvement.montant,
                  Statut: d.mouvement.cancelledAt
                    ? `Annulée par ${d.mouvement.cancelledByName ?? "—"}`
                    : "Active",
                })),
              },
            ]);
            return Promise.resolve();
          }}
        />
      }
    >
      <ContextBar
        date={date}
        onDateChange={setDate}
        siteLabel={CAISSE_SHORT_LABELS[caisse]}
      >
        {allowed.length > 1 ? (
          <div className="site-switch caisse-switch" role="tablist" aria-label="Caisse">
            {allowed.map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={caisse === c}
                className={`site-btn${caisse === c ? " is-active" : ""}`}
                onClick={() => setCaisse(c)}
              >
                {CAISSE_SHORT_LABELS[c]}
              </button>
            ))}
          </div>
        ) : null}
      </ContextBar>

      <div className="section-tabs" role="tablist" aria-label="Saisie">
        {(
          [
            ["depenses", "Dépenses"],
            ["stock", "Stock"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`section-tab${tab === key ? " is-active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="error-banner" role="alert">{error}</p> : null}
      {flash ? (
        <p className="ui-info" role="status">
          <span className="ui-info-mark" aria-hidden>
            i
          </span>
          {flash}
        </p>
      ) : null}

      {tab === "depenses" ? (
        loading || !data ? (
          <BrandLoader variant="ligne" label="Chargement des achats…" />
        ) : (
          <div className="dash">
            <section className="panel">
              <h2 className="panel-title">Nouvelle dépense — {CAISSE_LABELS[caisse]}</h2>
              {!caisseOpen ? (
                <p className="warn-inline">
                  Caisse du site fermée : ouvrez-la depuis l’écran Caisse pour
                  enregistrer une dépense.
                </p>
              ) : null}
              <div className="caisse-form-grid">
                <label className="caisse-field">
                  <span>Explication (obligatoire)</span>
                  <input
                    value={nature}
                    onChange={(e) => setNature(e.target.value)}
                    placeholder="Ex. achat riz, gaz, transport, électricité…"
                  />
                </label>
                <label className="caisse-field">
                  <span>Montant (FCFA)</span>
                  <input
                    type="number"
                    min={0}
                    value={montant}
                    onChange={(e) => setMontant(e.target.value)}
                  />
                </label>
                <label className="caisse-field">
                  <span>Bénéficiaire / fournisseur (facultatif)</span>
                  <input
                    value={beneficiaire}
                    onChange={(e) => setBeneficiaire(e.target.value)}
                    placeholder="Ex. marché Dantokpa"
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  saving ||
                  !caisseOpen ||
                  nature.trim().length < 2 ||
                  (Number(montant.replace(",", ".")) || 0) <= 0
                }
                onClick={() => void submitDepense()}
              >
                {saving ? "Enregistrement…" : "Enregistrer la dépense"}
              </button>
            </section>

            <section className="panel">
              <h2 className="panel-title">
                Dépenses du jour · {formatFcfa(totalDepenses)}
              </h2>
              {data.depenses.length === 0 ? (
                <p className="muted">Aucune dépense ce jour sur la {CAISSE_LABELS[caisse].toLowerCase()}.</p>
              ) : (
                <ul className="vente-log">
                  {data.depenses.map((d) => (
                    <li
                      key={d.mouvement.id}
                      className={d.mouvement.cancelledAt ? "is-cancelled" : undefined}
                    >
                      <div>
                        <strong>{formatFcfa(d.mouvement.montant)}</strong>
                        {" · "}
                        {d.mouvement.nature}
                        {d.mouvement.beneficiaire ? (
                          <span className="muted"> — {d.mouvement.beneficiaire}</span>
                        ) : null}
                        <div className="vente-log-time muted">
                          {formatTime(d.mouvement.at)}
                          {d.sessionUserName ? ` · par ${d.sessionUserName}` : ""}
                          {d.mouvement.cancelledAt
                            ? ` · annulée par ${d.mouvement.cancelledByName ?? "—"}`
                            : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )
      ) : loading || !day || !computed ? (
        <BrandLoader variant="ligne" label="Chargement des achats…" />
      ) : materials.length === 0 ? (
        <p className="ui-info">
          Aucune matière définie. Ajoutez-les dans Paramètres → Matières.
        </p>
      ) : (
        <>
          {fournisseurs.length > 0 ? (
            <div className="ui-info" role="note">
              <span className="ui-info-mark" aria-hidden>
                i
              </span>
              <label className="vente-field">
                <span>Fournisseur des achats saisis</span>
                <select
                  value={fournisseurId}
                  onChange={(e) => setFournisseurId(e.target.value)}
                >
                  <option value="">— non précisé</option>
                  {fournisseurs.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nom}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          <section className="panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Matière</th>
                  <th className="col-num">Stock</th>
                  <th className="col-num">Achats jour</th>
                  <th>Nouvel achat</th>
                </tr>
              </thead>
              <tbody>
                {computed.lines.map((line) => (
                  <tr key={line.productId}>
                    <td>
                      <strong>{line.name}</strong>
                      {line.unit ? (
                        <span className="muted"> · {line.unit}</span>
                      ) : null}
                      {line.stock <= 0 ? (
                        <span className="vente-out-badge vente-out-badge-inline">
                          ÉPUISÉ
                        </span>
                      ) : line.belowThreshold ? (
                        <span className="vente-low-badge vente-low-badge-inline">
                          Bientôt épuisé
                        </span>
                      ) : null}
                    </td>
                    <td className="col-num mono">{line.stock}</td>
                    <td className="col-num mono">{line.purchases}</td>
                    <td>
                      <div className="inline-buy">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          className="input-num"
                          value={draftBuy[line.productId] ?? ""}
                          onChange={(e) =>
                            setDraftBuy((d) => ({
                              ...d,
                              [line.productId]: e.target.value,
                            }))
                          }
                          aria-label={`Achat ${line.name}`}
                        />
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busyId === `buy-${line.productId}`}
                          onClick={() =>
                            void submitPurchase(
                              line.productId,
                              draftBuy[line.productId] ?? "",
                            )
                          }
                        >
                          + Achat
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h2 className="panel-title">Registre des achats de stock</h2>
            {(day.movements ?? []).length === 0 ? (
              <p className="muted">Aucun mouvement aujourd’hui.</p>
            ) : (
              <ul className="vente-log">
                {(day.movements ?? []).map((m) => (
                  <li
                    key={m.id}
                    className={m.cancelledAt ? "is-cancelled" : undefined}
                  >
                    <div>
                      <strong>
                        +{m.qty} × {m.name}
                      </strong>
                      {m.unitPrice > 0 ? (
                        <span className="muted">
                          {" "}
                          ({formatFcfa(m.unitPrice)} / u)
                        </span>
                      ) : null}
                      <div className="vente-log-time muted">
                        {formatTime(m.at)}
                        {m.fournisseurNom ? ` · ${m.fournisseurNom}` : ""}
                        {m.cancelledAt ? " · annulé" : ""}
                      </div>
                    </div>
                    {!m.cancelledAt ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busyId === `cancel-${m.id}`}
                        onClick={() => void cancelMovement(m)}
                      >
                        Annuler
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

    </AppShell>
  );
}