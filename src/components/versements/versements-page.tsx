"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ExportExcelButton } from "@/components/export-excel-button";
import { CataloguePaginationBar } from "@/components/parametres/catalogue-view";
import { useSession } from "@/components/session-provider";
import {
  effectiveSite,
  SITE_LABELS,
  SHIFT_LABELS,
} from "@/lib/auth-types";
import { formatFcfa } from "@/lib/format";
import { exportVersementsExcel } from "@/lib/page-exports";
import {
  VERSEMENT_STATUT_LABELS,
  VERSEMENT_TRANCHE_LABELS,
  type Versement,
  type VersementStatut,
  type VersementTranche,
  type VenteSite,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import {
  defaultTrancheFromShift,
  MAX_PREUVES,
} from "@/lib/versements-model";
import "./versements-page.css";

type StatutFilter = "all" | VersementStatut;
type SiteFilter = "all" | VenteSite;

const PAGE_SIZE = 10;

type DeskView = "declare" | "registre";

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
  const [preuves, setPreuves] = useState<File[]>([]);
  const [preuvePreviews, setPreuvePreviews] = useState<string[]>([]);
  const [dropActive, setDropActive] = useState(false);

  const [versements, setVersements] = useState<Versement[]>([]);
  const [statutFilter, setStatutFilter] = useState<StatutFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Versement | null>(null);
  const [desk, setDesk] = useState<DeskView>("registre");

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
    if (!scope) {
      setLoading(false);
      return;
    }
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
    const urls = preuves.map((file) => URL.createObjectURL(file));
    setPreuvePreviews(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [preuves]);

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
    setDesk("declare");
    window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }

  const formReady =
    Boolean(montant) &&
    Boolean(numero.trim()) &&
    preuves.length > 0 &&
    membres.some((m) => m.trim().length >= 2);

  function isAllowedImage(file: File): boolean {
    const type = (file.type || "").toLowerCase();
    const name = file.name.toLowerCase();
    return (
      type === "image/jpeg" ||
      type === "image/jpg" ||
      type === "image/png" ||
      type === "image/webp" ||
      (!type &&
        (name.endsWith(".jpg") ||
          name.endsWith(".jpeg") ||
          name.endsWith(".png") ||
          name.endsWith(".webp")))
    );
  }

  function addPreuves(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files);
    const next = [...preuves];
    for (const file of incoming) {
      if (next.length >= MAX_PREUVES) {
        setError(`Maximum ${MAX_PREUVES} captures.`);
        break;
      }
      if (!isAllowedImage(file)) {
        setError("Capture d’écran : JPEG, PNG ou WebP uniquement.");
        continue;
      }
      if (file.size > 4 * 1024 * 1024) {
        setError("Capture d’écran trop lourde (max. 4 Mo par image).");
        continue;
      }
      next.push(file);
    }
    if (next.length > preuves.length) setError(null);
    setPreuves(next);
  }

  function removePreuve(index: number) {
    setPreuves((prev) => prev.filter((_, i) => i !== index));
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDropActive(false);
    addPreuves(e.dataTransfer.files);
  }

  async function onDeclare(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!canDeclare) {
      setError("Votre compte ne peut pas déclarer de versement.");
      return;
    }
    if (!formReady) {
      setError(
        "Complétez montant, n° de transaction, membres présents et capture.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      if (preuves.length === 0) throw new Error("Joignez au moins une capture.");
      const form = new FormData();
      form.set("date", declareDate);
      form.set("site", site);
      form.set("heureTransaction", heure.slice(0, 5));
      form.set("trancheHoraire", tranche);
      for (const nom of membres) {
        if (nom.trim()) form.append("membresPresents", nom.trim());
      }
      form.set("montant", montant);
      form.set("numeroTransaction", numero);
      for (const file of preuves) {
        form.append("preuve", file);
      }
      const res = await fetch("/api/versements", {
        method: "POST",
        body: form,
      });
      let body: { error?: string } = {};
      try {
        body = (await res.json()) as { error?: string };
      } catch {
        throw new Error(
          res.ok
            ? "Réponse serveur invalide."
            : `Enregistrement impossible (${res.status}).`,
        );
      }
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible.");
      setMontant("");
      setNumero("");
      setMembres([""]);
      setPreuves([]);
      setHeure(nowHeureLocale());
      setTranche(defaultTrancheFromShift(user?.shift));
      setDate(declareDate);
      setFlash("Versement enregistré — en attente de confirmation.");
      setDesk("registre");
      await charger();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
      setDesk("declare");
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
      actions={
        <>
          <ExportExcelButton
            disabled={loading || filtered.length === 0}
            className="btn btn-ghost"
            onExport={() => {
              exportVersementsExcel({
                versements: filtered,
                from: followAll ? from : undefined,
                to: followAll ? to : undefined,
                date: followAll ? undefined : date,
                site: followAll
                  ? filterSite === "all"
                    ? "tous"
                    : filterSite
                  : site,
                statutLabel:
                  statutFilter === "all"
                    ? undefined
                    : VERSEMENT_STATUT_LABELS[statutFilter],
              });
              return Promise.resolve();
            }}
          />
          {canDeclare ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={focusForm}
            >
              + Nouveau versement
            </button>
          ) : canConfirm && totals.pending > 0 ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setStatutFilter("en_attente");
                setDesk("registre");
              }}
            >
              {totals.pending} à confirmer
            </button>
          ) : null}
        </>
      }
    >
      <div className="versements-page">
        <div className="versements-strip" role="group" aria-label="Totaux">
          <button
            type="button"
            className="versements-strip-cell"
            onClick={() => {
              setStatutFilter("all");
              setDesk("registre");
            }}
          >
            <span>Période</span>
            <strong>{loading ? "…" : formatFcfa(totals.totalAmount)}</strong>
            <em>
              {loading
                ? "…"
                : `${totals.totalCount} versement${totals.totalCount > 1 ? "s" : ""}`}
            </em>
          </button>
          <button
            type="button"
            className={`versements-strip-cell is-pending${statutFilter === "en_attente" ? " is-on" : ""}`}
            onClick={() => {
              setStatutFilter("en_attente");
              setDesk("registre");
            }}
          >
            <span>À confirmer</span>
            <strong>
              {loading ? "…" : formatFcfa(totals.pendingAmount)}
            </strong>
            <em>
              {loading ? "…" : `${totals.pending} en attente`}
            </em>
          </button>
          <button
            type="button"
            className={`versements-strip-cell is-ok${statutFilter === "confirmee" ? " is-on" : ""}`}
            onClick={() => {
              setStatutFilter("confirmee");
              setDesk("registre");
            }}
          >
            <span>Confirmés</span>
            <strong>
              {loading ? "…" : formatFcfa(totals.confirmedAmount)}
            </strong>
            <em>
              {loading
                ? "…"
                : `${totals.confirmed} verrouillé${totals.confirmed > 1 ? "s" : ""}`}
            </em>
          </button>
        </div>

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

        {canDeclare ? (
          <nav className="versements-desk-nav" role="tablist" aria-label="Bureau">
            <button
              type="button"
              role="tab"
              aria-selected={desk === "declare"}
              className={`versements-desk-tab${desk === "declare" ? " is-active" : ""}`}
              onClick={() => setDesk("declare")}
            >
              Déclarer
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={desk === "registre"}
              className={`versements-desk-tab${desk === "registre" ? " is-active" : ""}`}
              onClick={() => setDesk("registre")}
            >
              Registre
              {totals.pending > 0 ? (
                <i>{totals.pending}</i>
              ) : null}
            </button>
          </nav>
        ) : null}

        {canDeclare && desk === "declare" ? (
          <section
            ref={formRef}
            className="versements-bordereau"
            id="nouveau-versement"
            aria-label="Nouveau versement"
          >
            <form className="versements-bordereau-form" onSubmit={onDeclare}>
              <div className="versements-bordereau-main">
                <header className="versements-bordereau-head">
                  <h2>Bordereau de versement</h2>
                  <p>Une fois envoyé, plus aucune modification.</p>
                </header>

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
              </div>

              <aside className="versements-bordereau-side">
                <label
                  className={`versements-dropzone${dropActive ? " is-active" : ""}${preuves.length ? " has-file" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropActive(true);
                  }}
                  onDragLeave={() => setDropActive(false)}
                  onDrop={onDrop}
                >
                  <span>Captures d’écran</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={(e) => {
                      addPreuves(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  {preuves.length === 0 ? (
                    <em>
                      Une ou plusieurs images — JPEG, PNG, WebP · 4 Mo max ·
                      jusqu’à {MAX_PREUVES}
                    </em>
                  ) : (
                    <em>
                      {preuves.length} image{preuves.length > 1 ? "s" : ""} —
                      cliquez pour en ajouter
                      {preuves.length < MAX_PREUVES
                        ? ` (${MAX_PREUVES - preuves.length} restantes)`
                        : ""}
                    </em>
                  )}
                </label>

                {preuves.length > 0 ? (
                  <ul className="versements-preuves-grid" aria-label="Aperçus">
                    {preuves.map((file, index) => (
                      <li key={`${file.name}-${file.size}-${index}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={preuvePreviews[index]}
                          alt=""
                          className="versements-preuve-preview"
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => removePreuve(index)}
                        >
                          Retirer
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <ul className="versements-checks" aria-label="Pièces du bordereau">
                  <li className={montant ? "is-ok" : ""}>Montant</li>
                  <li className={numero.trim() ? "is-ok" : ""}>N° de transaction</li>
                  <li
                    className={
                      membres.some((m) => m.trim().length >= 2) ? "is-ok" : ""
                    }
                  >
                    Membres
                  </li>
                  <li className={preuves.length > 0 ? "is-ok" : ""}>
                    Capture{preuves.length > 1 ? `s (${preuves.length})` : ""}
                  </li>
                </ul>

                <button
                  type="submit"
                  className="btn btn-primary versements-submit"
                  disabled={busy || !formReady}
                >
                  {busy ? "Enregistrement…" : "Envoyer le bordereau"}
                </button>
                {error ? (
                  <p className="error-banner" role="alert">
                    {error}
                  </p>
                ) : null}
              </aside>
            </form>
          </section>
        ) : (
          <section className="versements-ledger" aria-label="Liste des versements">
            <div className="versements-ledger-head">
              <div className="versements-ledger-title">
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
                      ? "Passez sur l’onglet Déclarer pour la première ligne."
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
                <div className="table-scroll">
                  <table className="data-table versements-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Tranche</th>
                        {followAll ? <th>Site</th> : null}
                        <th>N°</th>
                        <th className="num">Montant</th>
                        <th>Statut</th>
                        <th className="versements-col-action">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.items.map((v) => (
                        <tr
                          key={v.id}
                          className={
                            v.statut === "en_attente" ? "is-pending" : ""
                          }
                        >
                          <td className="versements-td-date">
                            <button
                              type="button"
                              className="versements-row-open"
                              onClick={() => setSelected(v)}
                            >
                              {formatDateFr(v.date)}
                              <small>
                                {v.heureTransaction} · {v.actorName}
                              </small>
                            </button>
                          </td>
                          <td>{TRANCHE_SHORT[v.trancheHoraire]}</td>
                          {followAll ? <td>{SITE_LABELS[v.site]}</td> : null}
                          <td>
                            <code className="versements-numero">
                              {v.numeroTransaction}
                            </code>
                          </td>
                          <td className="num mono versements-td-amount">
                            {formatFcfa(v.montant)}
                          </td>
                          <td>
                            <span className={`versements-statut is-${v.statut}`}>
                              {VERSEMENT_STATUT_LABELS[v.statut]}
                            </span>
                          </td>
                          <td className="versements-col-action">
                            {canConfirm && v.statut === "en_attente" ? (
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={busy}
                                onClick={() => void onConfirm(v.id)}
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
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
        )}

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
                <div className="versements-modal-head-main">
                  <p className="versements-modal-kicker">Détail du versement</p>
                  <h2 id="versements-modal-title">
                    {formatFcfa(selected.montant)}
                  </h2>
                  <div className="versements-modal-head-meta">
                    <span className={`versements-statut is-${selected.statut}`}>
                      {VERSEMENT_STATUT_LABELS[selected.statut]}
                    </span>
                    <span>
                      {formatDateFr(selected.date)} · {selected.heureTransaction} ·{" "}
                      {SITE_LABELS[selected.site]}
                    </span>
                  </div>
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
                <div className="versements-modal-info">
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
                      <dd>
                        {VERSEMENT_TRANCHE_LABELS[selected.trancheHoraire]}
                      </dd>
                    </div>
                    <div>
                      <dt>Site</dt>
                      <dd>{SITE_LABELS[selected.site]}</dd>
                    </div>
                    <div className="is-wide">
                      <dt>Membres</dt>
                      <dd>
                        {selected.membresPresents.length
                          ? selected.membresPresents.join(", ")
                          : "—"}
                      </dd>
                    </div>
                    <div className="is-wide">
                      <dt>N° transaction</dt>
                      <dd>
                        <code className="versements-numero">
                          {selected.numeroTransaction}
                        </code>
                      </dd>
                    </div>
                    <div className="is-wide">
                      <dt>Déclaré</dt>
                      <dd>
                        {formatDateHeure(selected.createdAt)} —{" "}
                        {selected.actorName} ({SHIFT_LABELS[selected.shift]})
                      </dd>
                    </div>
                    <div className="is-wide">
                      <dt>Confirmé</dt>
                      <dd>
                        {selected.confirmedAt
                          ? `${formatDateHeure(selected.confirmedAt)} — ${selected.confirmedByName}`
                          : "En attente"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <figure className="versements-preuve-figure">
                  <figcaption>
                    Capture
                    {(selected.preuves?.length ?? 1) > 1
                      ? `s (${selected.preuves.length})`
                      : ""}
                  </figcaption>
                  <div className="versements-preuve-gallery">
                    {(selected.preuves?.length
                      ? selected.preuves
                      : [
                          {
                            url:
                              selected.preuveUrl ||
                              `/api/versements/${selected.id}/preuve`,
                            mime: selected.preuveMime,
                            publicId: selected.preuvePublicId,
                          },
                        ]
                    ).map((p, index) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={`${p.url}-${index}`}
                        src={p.url}
                        alt={`Capture ${index + 1}`}
                      />
                    ))}
                  </div>
                </figure>
              </div>

              <footer className="versements-modal-foot">
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
                ) : (
                  <p className="versements-locked-note">
                    En attente de confirmation par le comptable.
                  </p>
                )}
              </footer>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
