"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { CataloguePaginationBar } from "@/components/parametres/catalogue-view";
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

const PAGE_SIZE = 10;

const TRANCHE_SHORT: Record<VersementTranche, string> = {
  nuit: "Nuit",
  matin: "Matin",
  soir: "Soir",
};

function monthStartIso(d = todayIsoDate()): string {
  return `${d.slice(0, 7)}-01`;
}

function formatDateFr(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(`${iso}T12:00:00`));
  } catch {
    return iso;
  }
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

function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function useDebouncedValue<T>(value: T, delayMs = 280): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
  };
}

export function VersementsPage() {
  const { user } = useSession();
  const scope = user ? effectiveSite(user.role, user.site) : null;
  const followAll = scope === "tous";
  const isReaderOnly = user?.role === "admin" || user?.role === "daf";
  const formRef = useRef<HTMLElement | null>(null);

  const [declareDate, setDeclareDate] = useState(() => todayIsoDate());
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
  const [dropActive, setDropActive] = useState(false);

  const [versements, setVersements] = useState<Versement[]>([]);
  const [statutFilter, setStatutFilter] = useState<StatutFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Versement | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

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

  useEffect(() => {
    if (!selected) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const filtered = useMemo(() => {
    const q = normalizeSearch(debouncedSearch);
    const list = versements.filter((v) => {
      if (statutFilter !== "all" && v.statut !== statutFilter) return false;
      if (!q) return true;
      const blob = [
        v.numeroTransaction,
        v.actorName,
        v.confirmedByName ?? "",
        SITE_LABELS[v.site],
        TRANCHE_SHORT[v.trancheHoraire],
        String(v.montant),
        v.membresPresents.join(" "),
        v.date,
      ].join(" ");
      return normalizeSearch(blob).includes(q);
    });
    return [...list].sort((a, b) => {
      if (a.statut !== b.statut) return a.statut === "en_attente" ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [versements, statutFilter, debouncedSearch]);

  const paged = useMemo(
    () => paginate(filtered, page, PAGE_SIZE),
    [filtered, page],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statutFilter, date, from, to, filterSite]);

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
      totalCount: pending + confirmed,
    };
  }, [versements]);

  function focusForm() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function pickPreuve(file: File | null) {
    setPreuve(file);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDropActive(false);
    pickPreuve(e.dataTransfer.files?.[0] ?? null);
  }

  async function onDeclare(e: FormEvent) {
    e.preventDefault();
    if (busy || !canDeclare) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      if (!preuve) throw new Error("Joignez la capture d’écran.");
      const form = new FormData();
      form.set("date", declareDate);
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
      setDate(declareDate);
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

  function onRowKey(e: KeyboardEvent<HTMLElement>, v: Versement) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelected(v);
    }
  }

  const siteLocked = scope === "zogbo" || scope === "gbegamey";
  const formReady =
    Boolean(montant) &&
    Boolean(numero) &&
    Boolean(preuve) &&
    membres.some((m) => m.trim().length >= 2);

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
      actions={
        canDeclare ? (
          <button type="button" className="btn btn-primary" onClick={focusForm}>
            + Nouveau versement
          </button>
        ) : canConfirm && totals.pending > 0 ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setStatutFilter("en_attente")}
          >
            {totals.pending} à confirmer
          </button>
        ) : null
      }
    >
      <div className="versements-page">
        <header className="versements-hero">
          <ol className="versements-steps" aria-label="Parcours">
            {canDeclare ? (
              <>
                <li>
                  <span>1</span> Saisir le versement
                </li>
                <li>
                  <span>2</span> Joindre la capture
                </li>
                <li>
                  <span>3</span> Le comptable confirme
                </li>
              </>
            ) : canConfirm ? (
              <>
                <li>
                  <span>1</span> Ouvrir la ligne
                </li>
                <li>
                  <span>2</span> Vérifier la preuve
                </li>
                <li>
                  <span>3</span> Confirmer — verrouillé
                </li>
              </>
            ) : (
              <>
                <li>
                  <span>1</span> Consulter le registre
                </li>
                <li>
                  <span>2</span> Ouvrir une preuve
                </li>
                <li className="is-mute">
                  <span>3</span> Confirmation réservée au comptable
                </li>
              </>
            )}
          </ol>
          <div className="versements-kpis" aria-label="Totaux">
            <div className="versements-kpi is-gold">
              <span>Total période</span>
              <strong>{loading ? "…" : formatFcfa(totals.totalAmount)}</strong>
              <em>
                {loading
                  ? "…"
                  : `${totals.totalCount} versement${totals.totalCount > 1 ? "s" : ""}`}
              </em>
            </div>
            <div className="versements-kpi is-pending">
              <span>En attente</span>
              <strong>
                {loading ? "…" : formatFcfa(totals.pendingAmount)}
              </strong>
              <em>
                {loading
                  ? "…"
                  : `${totals.pending} à confirmer`}
              </em>
            </div>
            <div className="versements-kpi is-ok">
              <span>Confirmés</span>
              <strong>
                {loading ? "…" : formatFcfa(totals.confirmedAmount)}
              </strong>
              <em>
                {loading
                  ? "…"
                  : `${totals.confirmed} verrouillé${totals.confirmed > 1 ? "s" : ""}`}
              </em>
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
              ref={formRef}
              className="versements-declare"
              id="nouveau-versement"
              aria-label="Nouveau versement"
            >
              <div className="versements-declare-head">
                <h2>Nouveau versement</h2>
                <p>Une fois envoyé, plus aucune modification.</p>
              </div>
              <form className="versements-form" onSubmit={onDeclare}>
                <fieldset className="versements-fieldset">
                  <legend>Contexte</legend>
                  <div className="versements-form-grid">
                    <label className="versements-field">
                      <span>Jour</span>
                      <input
                        type="date"
                        value={declareDate}
                        max={todayIsoDate()}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                          setDeclareDate(v);
                        }}
                        required
                      />
                    </label>
                    {siteLocked ? (
                      <div className="versements-field">
                        <span>Site</span>
                        <p className="versements-readonly">{SITE_LABELS[site]}</p>
                      </div>
                    ) : (
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
                    )}
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
                      <span>Tranche</span>
                      <select
                        value={tranche}
                        onChange={(e) =>
                          setTranche(e.target.value as VersementTranche)
                        }
                        required
                      >
                        {(
                          Object.keys(
                            VERSEMENT_TRANCHE_LABELS,
                          ) as VersementTranche[]
                        ).map((key) => (
                          <option key={key} value={key}>
                            {VERSEMENT_TRANCHE_LABELS[key]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </fieldset>

                <fieldset className="versements-membres">
                  <legend>Membres présents</legend>
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

                <fieldset className="versements-fieldset">
                  <legend>Paiement</legend>
                  <div className="versements-form-grid">
                    <label className="versements-field">
                      <span>Montant</span>
                      <div className="versements-amount-wrap">
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
                        <span className="versements-amount-suffix">FCFA</span>
                      </div>
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
                  </div>
                </fieldset>

                <label
                  className={`versements-dropzone${dropActive ? " is-active" : ""}${preuvePreview ? " has-file" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropActive(true);
                  }}
                  onDragLeave={() => setDropActive(false)}
                  onDrop={onDrop}
                >
                  <span>Capture d’écran</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => pickPreuve(e.target.files?.[0] ?? null)}
                  />
                  {preuvePreview ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={preuvePreview}
                        alt=""
                        className="versements-preuve-preview"
                      />
                      <em>{preuve?.name}</em>
                    </>
                  ) : (
                    <em>Glissez une image ou cliquez — JPEG, PNG, WebP · 4 Mo max</em>
                  )}
                </label>

                <button
                  type="submit"
                  className="btn btn-primary versements-submit"
                  disabled={busy || loading || !formReady}
                >
                  {busy ? "Enregistrement…" : "Enregistrer le versement"}
                </button>
              </form>
            </section>
          ) : null}

          <section
            className="versements-board"
            aria-label="Liste des versements"
          >
            <div className="versements-board-head">
              <div className="versements-board-title">
                <h2>Registre</h2>
                {canConfirm && totals.pending > 0 ? (
                  <p className="versements-queue-note">
                    {totals.pending} en attente de votre confirmation
                  </p>
                ) : null}
              </div>
              <div className="versements-toolbar">
                <div className="versements-filters">
                  {followAll ? (
                    <>
                      <label className="versements-field">
                        <span>Du</span>
                        <input
                          type="date"
                          value={from}
                          max={todayIsoDate()}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                            setFrom(v);
                          }}
                        />
                      </label>
                      <label className="versements-field">
                        <span>Au</span>
                        <input
                          type="date"
                          value={to}
                          max={todayIsoDate()}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                            setTo(v);
                          }}
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
                        max={todayIsoDate()}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                          setDate(v);
                        }}
                      />
                    </label>
                  )}
                  <label className="versements-field versements-search-field">
                    <span>Recherche</span>
                    <input
                      type="search"
                      className="versements-search"
                      placeholder="N°, nom, site…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                <div
                  className="versements-status-filters"
                  role="group"
                  aria-label="Filtre statut"
                >
                  {(
                    [
                      ["all", "Tous", totals.totalCount],
                      ["en_attente", "En attente", totals.pending],
                      ["confirmee", "Confirmées", totals.confirmed],
                    ] as const
                  ).map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      className={`versements-filter-chip${statutFilter === key ? " is-active" : ""}`}
                      onClick={() => setStatutFilter(key)}
                    >
                      {label}
                      <i>{count}</i>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {loading || !scope ? (
              <BrandLoader label="Chargement du registre…" variant="ligne" />
            ) : filtered.length === 0 ? (
              <div className="versements-empty">
                <strong>
                  {versements.length === 0
                    ? "Aucun versement sur cette période"
                    : "Aucun versement trouvé"}
                </strong>
                <span>
                  {versements.length === 0
                    ? canDeclare
                      ? "Saisissez le premier versement à gauche."
                      : "Changez les dates ou le site pour élargir la période."
                    : "Modifiez la recherche ou le filtre de statut."}
                </span>
                {versements.length === 0 && canDeclare ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={focusForm}
                  >
                    + Nouveau versement
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <ul className="versements-list">
                  {paged.items.map((v) => (
                    <li
                      key={v.id}
                      className={`versements-row${v.statut === "en_attente" ? " is-pending" : ""}`}
                    >
                      <div
                        className="versements-row-open"
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelected(v)}
                        onKeyDown={(e) => onRowKey(e, v)}
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
                            {formatDateFr(v.date)} ·{" "}
                            {TRANCHE_SHORT[v.trancheHoraire]} · {v.heureTransaction}{" "}
                            · {SITE_LABELS[v.site]}
                          </p>
                          <p className="versements-row-meta">
                            {v.actorName}
                            {v.membresPresents.length
                              ? ` · ${v.membresPresents.join(", ")}`
                              : ""}
                            {v.confirmedByName
                              ? ` → ${v.confirmedByName}`
                              : " · en attente comptable"}
                          </p>
                          <code className="versements-numero">
                            {v.numeroTransaction}
                          </code>
                        </div>
                      </div>
                      <div className="versements-row-actions">
                        {canConfirm && v.statut === "en_attente" ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onConfirm(v.id);
                            }}
                          >
                            Confirmer
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setSelected(v)}
                        >
                          Voir
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <CataloguePaginationBar
                  from={paged.from}
                  to={paged.to}
                  total={paged.total}
                  page={paged.page}
                  totalPages={paged.totalPages}
                  onPage={setPage}
                  itemLabel="versement"
                />
              </>
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
              <div>
                <h2 id="versements-modal-title">
                  {formatFcfa(selected.montant)}
                </h2>
                <span className={`versements-statut is-${selected.statut}`}>
                  {VERSEMENT_STATUT_LABELS[selected.statut]}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSelected(null)}
              >
                Fermer
              </button>
            </header>

            <div className="versements-modal-body">
              <dl className="versements-detail">
                <div>
                  <dt>Jour</dt>
                  <dd>{formatDateFr(selected.date)}</dd>
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
                  <dt>Site</dt>
                  <dd>{SITE_LABELS[selected.site]}</dd>
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
                    {formatDateHeure(selected.createdAt)} — {selected.actorName}{" "}
                    ({SHIFT_LABELS[selected.shift]})
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
            </div>

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
