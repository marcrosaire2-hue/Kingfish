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
import { CataloguePaginationBar } from "@/components/parametres/catalogue-view";
import { useSession } from "@/components/session-provider";
import { formatDateFr } from "@/components/achats/achats-shared";
import { effectiveSite, SITE_LABELS } from "@/lib/auth-types";
import { defaultPeriodeFromShift } from "@/lib/compteur-model";
import {
  COMPTEUR_PERIODE_LABELS,
  type CompteurPeriode,
  type CompteurReleve,
  type VenteSite,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import "@/components/achats/achats-page.css";
import "@/components/fonds-caisse/fonds-caisse-suivi.css";
import "./compteur-page.css";

const RANGE_FROM = "2020-01-01";
const PAGE_SIZE = 12;

type PeriodeFilter = "all" | CompteurPeriode;
type SiteFilter = "all" | VenteSite;

function useDebouncedValue<T>(value: T, delayMs = 280): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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

function formatHeure(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeStyle: "short",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatQuantite(n: number): string {
  return Number.isInteger(n)
    ? String(n)
    : n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

export function CompteurPage() {
  const { user } = useSession();
  const scope = user ? effectiveSite(user.role, user.site) : null;
  const followAll = scope === "tous";
  const isReaderOnly =
    user?.role === "admin" ||
    user?.role === "daf" ||
    user?.role === "comptable";
  const composerRef = useRef<HTMLElement | null>(null);
  const qtyInputRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [draftDate, setDraftDate] = useState(() => todayIsoDate());
  const [site, setSite] = useState<VenteSite>("zogbo");
  const [filterSite, setFilterSite] = useState<SiteFilter>("all");
  const [periode, setPeriode] = useState<CompteurPeriode>("matin");
  const [quantite, setQuantite] = useState("");
  const [preuve, setPreuve] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [existingPreview, setExistingPreview] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const [releves, setReleves] = useState<CompteurReleve[]>([]);
  const [canDeclare, setCanDeclare] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [periodeFilter, setPeriodeFilter] = useState<PeriodeFilter>("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  useEffect(() => {
    if (scope === "zogbo" || scope === "gbegamey") setSite(scope);
  }, [scope]);

  useEffect(() => {
    if (user?.shift) setPeriode(defaultPeriodeFromShift(user.shift));
  }, [user?.shift]);

  useEffect(() => {
    if (!preuve) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(preuve);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [preuve]);

  const charger = useCallback(async () => {
    if (!scope) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        from: RANGE_FROM,
        to: todayIsoDate(),
      });
      if (followAll && filterSite !== "all") params.set("site", filterSite);
      const res = await fetch(`/api/compteur?${params}`, { cache: "no-store" });
      const body = (await res.json()) as {
        releves?: CompteurReleve[];
        canDeclare?: boolean;
        canUpdate?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Chargement impossible.");
      setReleves(body.releves ?? []);
      setCanDeclare(body.canDeclare === true);
      setCanUpdate(body.canUpdate === true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
      setReleves([]);
    } finally {
      setLoading(false);
    }
  }, [scope, followAll, filterSite]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const siteForForm = followAll ? site : (scope as VenteSite);
  const releveCourant = useMemo(
    () =>
      releves.find(
        (r) =>
          r.date === draftDate &&
          r.site === siteForForm &&
          r.periode === periode,
      ) ?? null,
    [releves, draftDate, siteForForm, periode],
  );

  useEffect(() => {
    if (releveCourant) {
      setQuantite(String(releveCourant.quantite));
      setExistingPreview(releveCourant.preuveUrl);
    } else {
      setQuantite("");
      setExistingPreview(null);
    }
    setPreuve(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id suffit
  }, [releveCourant?.id, periode, siteForForm, draftDate]);

  const sorted = useMemo(
    () =>
      [...releves].sort((a, b) => {
        const byDate = b.date.localeCompare(a.date);
        if (byDate !== 0) return byDate;
        return (b.updatedAt || b.createdAt).localeCompare(
          a.updatedAt || a.createdAt,
        );
      }),
    [releves],
  );

  const filtered = useMemo(() => {
    const q = normalizeSearch(debouncedSearch);
    return sorted.filter((r) => {
      if (periodeFilter !== "all" && r.periode !== periodeFilter) return false;
      if (!q) return true;
      const blob = [
        COMPTEUR_PERIODE_LABELS[r.periode],
        SITE_LABELS[r.site],
        String(r.quantite),
        r.actorName,
        r.date,
      ].join(" ");
      return normalizeSearch(blob).includes(q);
    });
  }, [sorted, debouncedSearch, periodeFilter]);

  const paged = useMemo(
    () => paginate(filtered, page, PAGE_SIZE),
    [filtered, page],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, periodeFilter, filterSite]);

  const today = todayIsoDate();
  const statusToday = useMemo(() => {
    const forSite = releves.filter(
      (r) =>
        r.date === today &&
        (followAll && filterSite === "all"
          ? r.site === siteForForm
          : r.site ===
            (followAll && filterSite !== "all" ? filterSite : siteForForm)),
    );
    return {
      matin: forSite.find((r) => r.periode === "matin") ?? null,
      soir: forSite.find((r) => r.periode === "soir") ?? null,
    };
  }, [releves, today, followAll, filterSite, siteForForm]);

  const counts = useMemo(() => {
    let matin = 0;
    let soir = 0;
    for (const r of releves) {
      if (r.periode === "matin") matin += 1;
      else soir += 1;
    }
    return { matin, soir, all: releves.length };
  }, [releves]);

  const lastDate = sorted[0]?.date ?? null;
  const canWrite = canDeclare || canUpdate;
  const siteLocked = scope === "zogbo" || scope === "gbegamey";

  function focusComposer() {
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => qtyInputRef.current?.focus(), 220);
  }

  function onPickFiles(files: FileList | File[] | null) {
    if (!files) return;
    const list = Array.from(files);
    const image = list.find(
      (f) =>
        /image\/(jpeg|jpg|png|webp)/i.test(f.type || "") ||
        /\.(jpe?g|png|webp)$/i.test(f.name),
    );
    if (!image) {
      setError("Capture : JPEG, PNG ou WebP uniquement.");
      return;
    }
    if (image.size > 4 * 1024 * 1024) {
      setError("Capture trop lourde (max. 4 Mo).");
      return;
    }
    setError(null);
    setPreuve(image);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDropActive(false);
    onPickFiles(e.dataTransfer.files);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || (!canDeclare && !canUpdate)) return;
    if (!releveCourant && !preuve) {
      setError("Joignez la capture d’écran du compteur (matin ou soir).");
      return;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const form = new FormData();
      form.set("date", draftDate);
      form.set("site", siteForForm);
      form.set("periode", periode);
      form.set("quantite", quantite);
      if (preuve) form.append("preuve", preuve);

      const res = await fetch("/api/compteur", { method: "POST", body: form });
      const body = (await res.json()) as {
        error?: string;
        entry?: CompteurReleve;
      };
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible.");

      setFlash(
        releveCourant
          ? `Relevé ${COMPTEUR_PERIODE_LABELS[periode].toLowerCase()} mis à jour.`
          : `Relevé ${COMPTEUR_PERIODE_LABELS[periode].toLowerCase()} enregistré.`,
      );
      setPreuve(null);
      await charger();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Enregistrement impossible.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Compteur électrique"
      subtitle={
        isReaderOnly
          ? "Consultation des relevés de courant restant (matin et soir)."
          : "Courant restant + capture d’écran, matin et soir."
      }
      mainClassName="main-achats main-compteur"
    >
      <div className="achats-page fcs-page">
        <header className="fcs-hero">
          <div>
            <h2 className="fcs-title">Compteur électrique</h2>
            <p className="fcs-sub">
              {isReaderOnly
          ? "Consultation des relevés de courant restant (matin et soir)."
          : "Courant restant + capture d’écran, matin et soir."}
              {isReaderOnly ? (
                <span className="fcs-badge">Lecture seule</span>
              ) : null}
            </p>
          </div>
          {canWrite ? (
            <button
              type="button"
              className="fcs-btn fcs-btn-primary"
              onClick={focusComposer}
            >
              + Nouveau relevé
            </button>
          ) : (
            <button
              type="button"
              className="fcs-btn"
              disabled={loading}
              onClick={() => void charger()}
            >
              Actualiser
            </button>
          )}
        </header>

        <section className="fcs-card" aria-label="Filtres">
          <h3 className="fcs-card-title">
            <svg viewBox="0 0 24 24" aria-hidden focusable="false">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            Filtres
          </h3>
          <div className="cpt-filters">
            {followAll ? (
              <div className="cpt-seg" role="tablist" aria-label="Site">
                {(
                  [
                    ["all", "Les deux"],
                    ["zogbo", SITE_LABELS.zogbo],
                    ["gbegamey", SITE_LABELS.gbegamey],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={filterSite === key}
                    className={`cpt-seg-btn${filterSite === key ? " is-active" : ""}`}
                    onClick={() => setFilterSite(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="cpt-seg" role="group" aria-label="Filtre période">
              {(
                [
                  ["all", "Tous", counts.all],
                  ["matin", "Matin", counts.matin],
                  ["soir", "Soir", counts.soir],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  className={`cpt-seg-btn${periodeFilter === key ? " is-active" : ""}`}
                  onClick={() => setPeriodeFilter(key)}
                >
                  {label}
                  <i>{count}</i>
                </button>
              ))}
            </div>
            <label className="fcs-field cpt-search">
              <span>Recherche</span>
              <input
                type="search"
                placeholder="Rechercher un relevé…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
        </section>

        <div className="fcs-stats" aria-label="État du jour">
          <article className="fcs-stat is-gold">
            <span className="fcs-stat-ico">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <path d="M12 3v2m0 14v2M5 12H3m18 0h-2M6.3 6.3 5 5m14 14-1.3-1.3M17.7 6.3 19 5M6.3 17.7 5 19M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
              </svg>
            </span>
            <div>
              <span className="fcs-stat-label">
                Matin · {formatDateFr(today)}
              </span>
              <strong>
                {loading
                  ? "…"
                  : statusToday.matin
                    ? `${formatQuantite(statusToday.matin.quantite)} KW`
                    : "—"}
              </strong>
              <small>Courant restant relevé le matin</small>
            </div>
          </article>
          <article className="fcs-stat is-blue">
            <span className="fcs-stat-ico">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
              </svg>
            </span>
            <div>
              <span className="fcs-stat-label">
                Soir · {formatDateFr(today)}
              </span>
              <strong>
                {loading
                  ? "…"
                  : statusToday.soir
                    ? `${formatQuantite(statusToday.soir.quantite)} KW`
                    : "—"}
              </strong>
              <small>Courant restant relevé le soir</small>
            </div>
          </article>
          <article className="fcs-stat is-neutral">
            <span className="fcs-stat-ico">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <path d="M4 6h16v14H4V6Zm0 5h16M8 3v4M16 3v4" />
              </svg>
            </span>
            <div>
              <span className="fcs-stat-label">Dernier relevé</span>
              <strong>
                {loading ? "…" : lastDate ? formatDateFr(lastDate) : "—"}
              </strong>
              <small>Date du dernier enregistrement</small>
            </div>
          </article>
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
          <p className="achats-flash" role="status">
            {flash}
          </p>
        ) : null}

        {canWrite ? (
          <section
            ref={composerRef}
            className="achats-composer"
            id="nouveau-releve"
            aria-label="Saisie d’un relevé"
          >
            <header className="achats-composer-head">
              <h2>Saisie rapide</h2>
              <p>
                {releveCourant
                  ? `Mise à jour du relevé ${COMPTEUR_PERIODE_LABELS[periode].toLowerCase()}.`
                  : "Indiquez le courant restant et joignez la capture d’écran."}
              </p>
            </header>
            <form
              className="achats-composer-grid"
              onSubmit={(e) => void onSubmit(e)}
            >
              <label className="achats-field">
                <span>Date</span>
                <input
                  type="date"
                  value={draftDate}
                  max={todayIsoDate()}
                  onChange={(e) => setDraftDate(e.target.value)}
                  required
                />
              </label>
              {followAll && !siteLocked ? (
                <label className="achats-field">
                  <span>Site</span>
                  <select
                    value={site}
                    onChange={(e) => setSite(e.target.value as VenteSite)}
                  >
                    <option value="zogbo">{SITE_LABELS.zogbo}</option>
                    <option value="gbegamey">{SITE_LABELS.gbegamey}</option>
                  </select>
                </label>
              ) : (
                <label className="achats-field">
                  <span>Site</span>
                  <input value={SITE_LABELS[siteForForm]} readOnly disabled />
                </label>
              )}
              <label className="achats-field">
                <span>Période</span>
                <select
                  value={periode}
                  onChange={(e) =>
                    setPeriode(e.target.value as CompteurPeriode)
                  }
                >
                  <option value="matin">{COMPTEUR_PERIODE_LABELS.matin}</option>
                  <option value="soir">{COMPTEUR_PERIODE_LABELS.soir}</option>
                </select>
              </label>
              <label className="achats-field">
                <span>Courant restant</span>
                <div className="achats-price-wrap">
                  <input
                    ref={qtyInputRef}
                    inputMode="decimal"
                    placeholder="ex. 125.5"
                    value={quantite}
                    onChange={(e) => setQuantite(e.target.value)}
                    required
                  />
                  <span className="achats-price-suffix">KW</span>
                </div>
              </label>

              <div className="achats-field achats-field-grow kw-preuve-field">
                <span>Capture d’écran</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => onPickFiles(e.target.files)}
                />
                <div
                  className={`kw-dropzone${dropActive ? " is-active" : ""}${preuve || existingPreview ? " has-file" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fileRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropActive(true);
                  }}
                  onDragLeave={() => setDropActive(false)}
                  onDrop={onDrop}
                >
                  <strong>
                    {preuve
                      ? preuve.name
                      : releveCourant
                        ? "Remplacer la capture (optionnel)"
                        : "Déposer ou choisir une capture"}
                  </strong>
                  <em>JPEG, PNG ou WebP · max. 4 Mo</em>
                </div>
                {(preview || existingPreview) && (
                  <div className="kw-preview-wrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview || existingPreview || ""}
                      alt={
                        preview
                          ? "Aperçu nouvelle capture"
                          : "Capture enregistrée"
                      }
                      className="kw-preview"
                    />
                    {preuve ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => setPreuve(null)}
                      >
                        Retirer
                      </button>
                    ) : null}
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="btn btn-primary achats-submit kw-submit"
                disabled={busy}
              >
                {busy
                  ? "…"
                  : releveCourant
                    ? "Mettre à jour"
                    : "Enregistrer"}
              </button>
            </form>
          </section>
        ) : null}

        <section className="fcs-card cpt-ledger" aria-label="Registre des relevés">
          <header className="fcs-history-head">
            <h3 className="fcs-card-title">Registre</h3>
            <p>
              {filtered.length} relevé{filtered.length > 1 ? "s" : ""}
            </p>
          </header>

          {loading ? (
            <div className="fcs-skeleton" aria-busy="true" aria-label="Chargement des relevés">
              <span className="fcs-skel-row" />
              <span className="fcs-skel-row" />
              <span className="fcs-skel-row" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="fcs-state">
              <span className="fcs-state-ico" aria-hidden>
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />
                </svg>
              </span>
              <strong>
                {sorted.length === 0
                  ? "Aucun relevé enregistré"
                  : "Aucun relevé trouvé"}
              </strong>
              <p>
                {sorted.length === 0
                  ? canWrite
                    ? "Saisissez le premier relevé avec le bouton « Nouveau relevé »."
                    : "Aucun relevé pour ce filtre."
                  : "Modifiez votre recherche ou vos filtres."}
              </p>
              {sorted.length === 0 && canWrite ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={focusComposer}
                >
                  + Nouveau relevé
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="table-scroll">
                <table className="data-table achats-table fcs-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Période</th>
                      {followAll ? <th>Site</th> : null}
                      <th className="num">Courant (KW)</th>
                      <th>Par</th>
                      <th>Heure</th>
                      <th className="achats-col-action">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.items.map((r) => {
                      const open = detailId === r.id;
                      return (
                        <tr
                          key={r.id}
                          className={open ? "is-open" : undefined}
                        >
                          <td className="achats-td-date">
                            {formatDateFr(r.date)}
                          </td>
                          <td>
                            <strong className="achats-td-name">
                              {COMPTEUR_PERIODE_LABELS[r.periode]}
                            </strong>
                            {open ? (
                              <p className="achats-td-detail">
                                {formatQuantite(r.quantite)} KW restant
                                {followAll
                                  ? ` · ${SITE_LABELS[r.site]}`
                                  : ""}
                                {" · "}
                                {formatHeure(r.updatedAt || r.createdAt)}
                                {r.updatedAt ? " · mis à jour" : ""}
                              </p>
                            ) : null}
                          </td>
                          {followAll ? <td>{SITE_LABELS[r.site]}</td> : null}
                          <td className="num mono achats-td-amount">
                            {formatQuantite(r.quantite)}
                          </td>
                          <td>{r.actorName}</td>
                          <td className="achats-td-date">
                            {formatHeure(r.updatedAt || r.createdAt)}
                          </td>
                          <td className="achats-col-action">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setLightbox(r.preuveUrl)}
                            >
                              Capture
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-expanded={open}
                              onClick={() =>
                                setDetailId(open ? null : r.id)
                              }
                            >
                              {open ? "Masquer" : "Détail"}
                            </button>
                            {canWrite &&
                            (siteLocked ? r.site === siteForForm : true) ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => {
                                  setDraftDate(r.date);
                                  setSite(r.site);
                                  setPeriode(r.periode);
                                  setQuantite(String(r.quantite));
                                  focusComposer();
                                }}
                              >
                                Modifier
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
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
                itemLabel="relevé"
              />
            </>
          )}
        </section>
      </div>

      {lightbox ? (
        <div
          className="kw-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Capture d’écran"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="btn btn-primary kw-lightbox-close"
            onClick={() => setLightbox(null)}
          >
            Fermer
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Capture du compteur"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </AppShell>
  );
}
