"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/session-provider";
import {
  effectiveSite,
  SITE_LABELS,
  SHIFT_LABELS,
} from "@/lib/auth-types";
import { formatFcfa } from "@/lib/format";
import {
  VERSEMENT_STATUT_LABELS,
  VERSEMENT_TRANCHE_LABELS,
  type Versement,
  type VersementStatut,
  type VersementTranche,
  type VenteSite,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import { defaultTrancheFromShift } from "@/lib/versements-model";
import "./versements-page.css";

type StatutFilter = "all" | VersementStatut;
type SiteFilter = "all" | VenteSite;

function monthStartIso(d = todayIsoDate()): string {
  return `${d.slice(0, 7)}-01`;
}

function formatDateHeure(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function nowHeureLocale(): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Africa/Porto-Novo",
    })
      .format(new Date())
      .replace(".", ":");
  } catch {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
}

export function VersementsPage() {
  const { user } = useSession();
  const scope = user ? effectiveSite(user.role, user.site) : null;
  const followAll = scope === "tous";
  const isReaderOnly = user?.role === "admin" || user?.role === "daf";

  const [date, setDate] = useState(() => todayIsoDate());
  const [from, setFrom] = useState(() => monthStartIso());
  const [to, setTo] = useState(() => todayIsoDate());
  const [site, setSite] = useState<VenteSite>("zogbo");
  const [filterSite, setFilterSite] = useState<SiteFilter>("all");
  const [canDeclare, setCanDeclare] = useState(false);
  const [canConfirm, setCanConfirm] = useState(false);

  const [heure, setHeure] = useState(() => nowHeureLocale());
  const [tranche, setTranche] = useState<VersementTranche>("matin");
  const [membres, setMembres] = useState<string[]>([""]);
  const [montant, setMontant] = useState("");
  const [numero, setNumero] = useState("");
  const [preuve, setPreuve] = useState<File | null>(null);
  const [preuvePreview, setPreuvePreview] = useState<string | null>(null);

  const [versements, setVersements] = useState<Versement[]>([]);
  const [statutFilter, setStatutFilter] = useState<StatutFilter>("all");
  const [selected, setSelected] = useState<Versement | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (scope === "zogbo" || scope === "gbegamey") setSite(scope);
  }, [scope]);

  useEffect(() => {
    if (user?.shift) setTranche(defaultTrancheFromShift(user.shift));
  }, [user?.shift]);

  const charger = useCallback(async () => {
    if (!scope) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (followAll) {
        params.set("from", from);
        params.set("to", to);
        if (filterSite !== "all") params.set("site", filterSite);
      } else {
        params.set("date", date);
      }
      const res = await fetch(`/api/versements?${params}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as {
        versements?: Versement[];
        canDeclare?: boolean;
        canConfirm?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Chargement impossible.");
      setVersements(body.versements ?? []);
      setCanDeclare(body.canDeclare === true);
      setCanConfirm(body.canConfirm === true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [scope, followAll, from, to, filterSite, date]);

  useEffect(() => {
    void charger();
  }, [charger]);

  useEffect(() => {
    if (!preuve) {
      setPreuvePreview(null);
      return;
    }
    const url = URL.createObjectURL(preuve);
    setPreuvePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [preuve]);

  const filtered = useMemo(() => {
    if (statutFilter === "all") return versements;
    return versements.filter((v) => v.statut === statutFilter);
  }, [versements, statutFilter]);

  const totals = useMemo(() => {
    let pending = 0;
    let confirmed = 0;
    let pendingAmount = 0;
    let confirmedAmount = 0;
    for (const v of versements) {
      if (v.statut === "en_attente") {
        pending += 1;
        pendingAmount += v.montant;
      } else {
        confirmed += 1;
        confirmedAmount += v.montant;
      }
    }
    return {
      pending,
      confirmed,
      pendingAmount,
      confirmedAmount,
      totalAmount: pendingAmount + confirmedAmount,
    };
  }, [versements]);

  async function onDeclare(e: FormEvent) {
    e.preventDefault();
    if (busy || !canDeclare) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      if (!preuve) throw new Error("Joignez la capture d’écran.");
      const form = new FormData();
      form.set("date", date);
      form.set("site", site);
      form.set("heureTransaction", heure);
      form.set("trancheHoraire", tranche);
      for (const nom of membres) {
        if (nom.trim()) form.append("membresPresents", nom.trim());
      }
      form.set("montant", montant);
      form.set("numeroTransaction", numero);
      form.set("preuve", preuve);
      const res = await fetch("/api/versements", {
        method: "POST",
        body: form,
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible.");
      setMontant("");
      setNumero("");
      setMembres([""]);
      setPreuve(null);
      setHeure(nowHeureLocale());
      setTranche(defaultTrancheFromShift(user?.shift));
      setFlash("Versement enregistré — en attente de confirmation.");
      await charger();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm(id: string) {
    if (busy || !canConfirm) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/versements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", id }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Confirmation impossible.");
      setFlash("Versement confirmé et verrouillé.");
      setSelected(null);
      await charger();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation impossible.");
    } finally {
      setBusy(false);
    }
  }

  const siteLocked = scope === "zogbo" || scope === "gbegamey";

  return (
    <AppShell
      title="Versements"
      subtitle={
        isReaderOnly
          ? "Consultation des déclarations et confirmations."
          : canDeclare
            ? "Déclarez le versement avec preuve, puis suivez les confirmations."
            : "Vérifiez la preuve puis confirmez la transaction."
      }
      mainClassName="main-versements"
    >
      <div className="versements-page">
        <header className="versements-hero">
          <div className="versements-hero-main">
            <p className="versements-hero-note">
              {isReaderOnly
                ? "Lecture seule — vous consultez les mouvements sans les modifier."
                : canDeclare
                  ? "Tranche, membres présents, heure, montant, n° de transaction et capture."
                  : "Ouvrez une ligne pour vérifier la preuve avant confirmation."}
            </p>
            {isReaderOnly ? (
              <p className="versements-hero-note is-warn">
                Confirmation réservée au comptable.
              </p>
            ) : null}
          </div>
          <div className="versements-kpis" aria-label="Totaux">
            <div className="versements-kpi is-gold">
              <span>Total</span>
              <strong>{loading ? "…" : formatFcfa(totals.totalAmount)}</strong>
            </div>
            <div className="versements-kpi is-pending">
              <span>En attente</span>
              <strong>
                {loading ? "…" : formatFcfa(totals.pendingAmount)}
              </strong>
            </div>
            <div className="versements-kpi is-ok">
              <span>Confirmés</span>
              <strong>
                {loading ? "…" : formatFcfa(totals.confirmedAmount)}
              </strong>
            </div>
          </div>
        </header>

        {error ? (
          <p className="error-banner" role="alert">
            {error}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void charger()}
            >
              Réessayer
            </button>
          </p>
        ) : null}
        {flash ? (
          <p className="versements-flash" role="status">
            {flash}
          </p>
        ) : null}

        <div className="versements-layout">
          {canDeclare ? (
            <section
              className="versements-declare"
              aria-label="Nouveau versement"
            >
              <h2>Nouveau versement</h2>
              <form className="versements-form" onSubmit={onDeclare}>
                {!siteLocked ? (
                  <label className="versements-field">
                    <span>Site</span>
                    <select
                      value={site}
                      onChange={(e) => setSite(e.target.value as VenteSite)}
                    >
                      <option value="zogbo">{SITE_LABELS.zogbo}</option>
                      <option value="gbegamey">{SITE_LABELS.gbegamey}</option>
                    </select>
                  </label>
                ) : null}
                <label className="versements-field">
                  <span>Heure</span>
                  <input
                    type="time"
                    value={heure}
                    onChange={(e) => setHeure(e.target.value)}
                    required
                  />
                </label>
                <label className="versements-field">
                  <span>Tranche d’horaire</span>
                  <select
                    value={tranche}
                    onChange={(e) =>
                      setTranche(e.target.value as VersementTranche)
                    }
                    required
                  >
                    {(
                      Object.keys(VERSEMENT_TRANCHE_LABELS) as VersementTranche[]
                    ).map((key) => (
                      <option key={key} value={key}>
                        {VERSEMENT_TRANCHE_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="versements-membres">
                  <legend>Membres présents</legend>
                  <p className="versements-membres-hint">
                    Nom de chaque membre présent.
                  </p>
                  {membres.map((nom, index) => (
                    <div key={index} className="versements-membre-row">
                      <input
                        type="text"
                        value={nom}
                        onChange={(e) => {
                          const next = [...membres];
                          next[index] = e.target.value;
                          setMembres(next);
                        }}
                        placeholder={`Membre ${index + 1}`}
                        autoComplete="name"
                        required={index === 0}
                      />
                      {membres.length > 1 ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          aria-label={`Retirer le membre ${index + 1}`}
                          onClick={() =>
                            setMembres(membres.filter((_, i) => i !== index))
                          }
                        >
                          Retirer
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {membres.length < 12 ? (
                    <button
                      type="button"
                      className="btn btn-ghost versements-add-membre"
                      onClick={() => setMembres([...membres, ""])}
                    >
                      + Ajouter un membre
                    </button>
                  ) : null}
                </fieldset>
                <label className="versements-field">
                  <span>Montant (FCFA)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={montant}
                    onChange={(e) => setMontant(e.target.value)}
                    placeholder="150000"
                    required
                  />
                </label>
                <label className="versements-field">
                  <span>N° de transaction</span>
                  <input
                    type="text"
                    value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                    maxLength={80}
                    placeholder="Référence MTN / Moov…"
                    autoCapitalize="characters"
                    required
                  />
                </label>
                <label className="versements-field versements-field-file">
                  <span>Capture d’écran</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setPreuve(e.target.files?.[0] ?? null)}
                    required
                  />
                  {preuvePreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={preuvePreview}
                      alt=""
                      className="versements-preuve-preview"
                    />
                  ) : null}
                </label>
                <button
                  type="submit"
                  className="btn btn-primary versements-submit"
                  disabled={
                    busy ||
                    loading ||
                    !montant ||
                    !numero ||
                    !preuve ||
                    !membres.some((m) => m.trim().length >= 2)
                  }
                >
                  {busy ? "Enregistrement…" : "Enregistrer"}
                </button>
              </form>
            </section>
          ) : null}

          <section
            className="versements-board"
            aria-label="Liste des versements"
          >
            <div className="versements-board-head">
              <h2>Registre</h2>
              <div className="versements-toolbar">
                <div className="versements-filters">
                  {followAll ? (
                    <>
                      <label className="versements-field">
                        <span>Du</span>
                        <input
                          type="date"
                          value={from}
                          onChange={(e) => setFrom(e.target.value)}
                        />
                      </label>
                      <label className="versements-field">
                        <span>Au</span>
                        <input
                          type="date"
                          value={to}
                          onChange={(e) => setTo(e.target.value)}
                        />
                      </label>
                      <label className="versements-field">
                        <span>Site</span>
                        <select
                          value={filterSite}
                          onChange={(e) =>
                            setFilterSite(e.target.value as SiteFilter)
                          }
                        >
                          <option value="all">Tous</option>
                          <option value="zogbo">{SITE_LABELS.zogbo}</option>
                          <option value="gbegamey">
                            {SITE_LABELS.gbegamey}
                          </option>
                        </select>
                      </label>
                    </>
                  ) : (
                    <label className="versements-field">
                      <span>Jour</span>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </label>
                  )}
                </div>
                <div
                  className="versements-status-filters"
                  role="group"
                  aria-label="Filtre statut"
                >
                  {(
                    [
                      ["all", "Tous"],
                      ["en_attente", "En attente"],
                      ["confirmee", "Confirmées"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`versements-filter-chip${statutFilter === key ? " is-active" : ""}`}
                      onClick={() => setStatutFilter(key)}
                    >
                      {label}
                      {key === "all"
                        ? ` · ${totals.pending + totals.confirmed}`
                        : key === "en_attente"
                          ? ` · ${totals.pending}`
                          : ` · ${totals.confirmed}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {loading || !scope ? (
              <p className="versements-empty">Chargement…</p>
            ) : filtered.length === 0 ? (
              <p className="versements-empty">
                Aucun versement sur cette période.
              </p>
            ) : (
              <ul className="versements-list">
                {filtered.map((v) => (
                  <li
                    key={v.id}
                    className={`versements-row${v.statut === "en_attente" ? " is-pending" : ""}`}
                  >
                    <div className="versements-row-main">
                      <div className="versements-row-top">
                        <span className={`versements-statut is-${v.statut}`}>
                          {VERSEMENT_STATUT_LABELS[v.statut]}
                        </span>
                        <strong className="versements-row-amount">
                          {formatFcfa(v.montant)}
                        </strong>
                      </div>
                      <p className="versements-row-meta">
                        {v.date} · {VERSEMENT_TRANCHE_LABELS[v.trancheHoraire]} ·
                        tx {v.heureTransaction} · {SITE_LABELS[v.site]}
                      </p>
                      <p className="versements-row-meta">
                        {v.actorName} · {SHIFT_LABELS[v.shift]}
                        {v.membresPresents.length
                          ? ` · présents : ${v.membresPresents.join(", ")}`
                          : ""}
                        {v.confirmedByName
                          ? ` → confirmé par ${v.confirmedByName}`
                          : " · en attente comptable"}
                      </p>
                      <code className="versements-numero">
                        {v.numeroTransaction}
                      </code>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setSelected(v)}
                    >
                      Voir
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {selected ? (
        <div
          className="versements-modal-backdrop"
          role="presentation"
          onClick={() => setSelected(null)}
        >
          <div
            className="versements-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="versements-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="versements-modal-head">
              <h2 id="versements-modal-title">
                {formatFcfa(selected.montant)}
              </h2>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSelected(null)}
              >
                Fermer
              </button>
            </header>

            <span className={`versements-statut is-${selected.statut}`}>
              {VERSEMENT_STATUT_LABELS[selected.statut]}
            </span>

            <dl className="versements-detail">
              <div>
                <dt>Jour</dt>
                <dd>{selected.date}</dd>
              </div>
              <div>
                <dt>Heure tx</dt>
                <dd>{selected.heureTransaction}</dd>
              </div>
              <div>
                <dt>Tranche</dt>
                <dd>{VERSEMENT_TRANCHE_LABELS[selected.trancheHoraire]}</dd>
              </div>
              <div>
                <dt>Membres</dt>
                <dd>
                  {selected.membresPresents.length
                    ? selected.membresPresents.join(", ")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>N°</dt>
                <dd>
                  <code className="versements-numero">
                    {selected.numeroTransaction}
                  </code>
                </dd>
              </div>
              <div>
                <dt>Déclaré</dt>
                <dd>
                  {formatDateHeure(selected.createdAt)} — {selected.actorName} (
                  {SHIFT_LABELS[selected.shift]}) · {SITE_LABELS[selected.site]}
                </dd>
              </div>
              <div>
                <dt>Confirmé</dt>
                <dd>
                  {selected.confirmedAt
                    ? `${formatDateHeure(selected.confirmedAt)} — ${selected.confirmedByName}`
                    : "En attente"}
                </dd>
              </div>
            </dl>

            <figure className="versements-preuve-figure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  selected.preuveUrl || `/api/versements/${selected.id}/preuve`
                }
                alt="Capture d’écran du paiement"
              />
            </figure>

            {canConfirm && selected.statut === "en_attente" ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void onConfirm(selected.id)}
              >
                {busy ? "Confirmation…" : "Confirmer la transaction"}
              </button>
            ) : selected.statut === "confirmee" ? (
              <p className="versements-locked-note">
                Transaction verrouillée.
              </p>
            ) : isReaderOnly ? (
              <p className="versements-locked-note">
                Consultation seule — confirmation réservée au comptable.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
