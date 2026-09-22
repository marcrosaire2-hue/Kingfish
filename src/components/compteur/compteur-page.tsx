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
import { useSession } from "@/components/session-provider";
import { effectiveSite, SITE_LABELS } from "@/lib/auth-types";
import { defaultPeriodeFromShift } from "@/lib/compteur-model";
import {
  COMPTEUR_PERIODE_LABELS,
  type CompteurPeriode,
  type CompteurReleve,
  type VenteSite,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import "./compteur-page.css";

type SiteFilter = "all" | VenteSite;

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
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [date, setDate] = useState(() => todayIsoDate());
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
      const params = new URLSearchParams({ date });
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
  }, [scope, date, followAll, filterSite]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const siteForForm = followAll ? site : (scope as VenteSite);
  const releveCourant = useMemo(
    () =>
      releves.find(
        (r) =>
          r.date === date &&
          r.site === siteForForm &&
          r.periode === periode,
      ) ?? null,
    [releves, date, siteForForm, periode],
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
    // Sync quand on change de période / site / jour (pas à chaque refresh liste).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id suffit
  }, [releveCourant?.id, periode, siteForForm, date]);

  const statusByPeriode = useMemo(() => {
    const forSite = followAll
      ? filterSite === "all"
        ? releves
        : releves.filter((r) => r.site === filterSite)
      : releves.filter((r) => r.site === siteForForm);
    return {
      matin: forSite.find((r) => r.periode === "matin") ?? null,
      soir: forSite.find((r) => r.periode === "soir") ?? null,
    };
  }, [releves, followAll, filterSite, siteForForm]);

  function onPickFiles(files: FileList | File[] | null) {
    if (!files) return;
    const list = Array.from(files);
    const image = list.find((f) =>
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
      form.set("date", date);
      form.set("site", siteForForm);
      form.set("periode", periode);
      form.set("quantite", quantite);
      if (preuve) form.append("preuve", preuve);

      const res = await fetch("/api/compteur", { method: "POST", body: form });
      const body = (await res.json()) as { error?: string; entry?: CompteurReleve };
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

  const siteLocked = scope === "zogbo" || scope === "gbegamey";
  const canWrite = canDeclare || canUpdate;

  return (
    <AppShell
      title="Compteur électrique"
      subtitle={
        isReaderOnly
          ? "Consultation des relevés de courant restant sur le compteur (matin et soir)."
          : "Chaque jour : courant restant sur le compteur + capture d’écran le matin et le soir."
      }
      mainClassName="main-compteur"
      actions={
        canWrite ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={loading}
            onClick={() => void charger()}
          >
            Actualiser
          </button>
        ) : undefined
      }
    >
      <div className="compteur-page">
        <section className="panel kw-toolbar" aria-label="Filtres">
          <div className="kw-field">
            <label htmlFor="kw-date">Jour</label>
            <input
              id="kw-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {followAll ? (
            <div className="kw-field">
              <label htmlFor="kw-filter-site">Site (liste)</label>
              <select
                id="kw-filter-site"
                value={filterSite}
                onChange={(e) =>
                  setFilterSite(e.target.value as SiteFilter)
                }
              >
                <option value="all">Les deux</option>
                <option value="zogbo">{SITE_LABELS.zogbo}</option>
                <option value="gbegamey">{SITE_LABELS.gbegamey}</option>
              </select>
            </div>
          ) : (
            <div className="kw-field">
              <label>Site</label>
              <input
                value={SITE_LABELS[siteForForm]}
                readOnly
                disabled
              />
            </div>
          )}
        </section>

        <section className="kw-status" aria-label="État du jour">
          {(["matin", "soir"] as CompteurPeriode[]).map((p) => {
            const entry = statusByPeriode[p];
            return (
              <article
                key={p}
                className={`kw-status-card${entry ? " is-done" : " is-missing"}`}
              >
                <span className="kw-status-label">
                  {COMPTEUR_PERIODE_LABELS[p]}
                </span>
                <strong className="kw-status-value mono">
                  {loading
                    ? "…"
                    : entry
                      ? formatQuantite(entry.quantite)
                      : "—"}
                </strong>
                <p className="kw-status-meta">
                  {loading
                    ? "Chargement…"
                    : entry
                      ? `Enregistré · ${formatHeure(entry.updatedAt || entry.createdAt)}`
                      : "Pas encore de relevé"}
                </p>
              </article>
            );
          })}
        </section>

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
          <p className="kw-flash" role="status">
            {flash}
          </p>
        ) : null}

        {canWrite ? (
          <section className="panel kw-composer" aria-label="Saisie du relevé">
            <h2>
              {releveCourant
                ? `Modifier — ${COMPTEUR_PERIODE_LABELS[periode]}`
                : `Nouveau relevé — ${COMPTEUR_PERIODE_LABELS[periode]}`}
            </h2>
            <form onSubmit={onSubmit}>
              <div className="kw-form-grid">
                {followAll && !siteLocked ? (
                  <div className="kw-field">
                    <label htmlFor="kw-site">Site</label>
                    <select
                      id="kw-site"
                      value={site}
                      onChange={(e) => setSite(e.target.value as VenteSite)}
                    >
                      <option value="zogbo">{SITE_LABELS.zogbo}</option>
                      <option value="gbegamey">{SITE_LABELS.gbegamey}</option>
                    </select>
                  </div>
                ) : null}
                <div className="kw-field" style={{ gridColumn: "1 / -1" }}>
                  <label>Période</label>
                  <div className="kw-periode" role="group" aria-label="Période">
                    {(["matin", "soir"] as CompteurPeriode[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={periode === p ? "is-on" : ""}
                        onClick={() => setPeriode(p)}
                      >
                        {COMPTEUR_PERIODE_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="kw-field">
                  <label htmlFor="kw-qty">Courant restant (compteur)</label>
                  <input
                    id="kw-qty"
                    inputMode="decimal"
                    placeholder="ex. 125.5"
                    value={quantite}
                    onChange={(e) => setQuantite(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="kw-field" style={{ marginTop: "0.85rem" }}>
                <label>Capture d’écran du compteur</label>
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
                  <span>JPEG, PNG ou WebP · max. 4 Mo</span>
                </div>
                <div className="kw-preview-wrap">
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={preview}
                      alt="Aperçu nouvelle capture"
                      className="kw-preview"
                    />
                  ) : existingPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={existingPreview}
                      alt="Capture enregistrée"
                      className="kw-preview"
                    />
                  ) : null}
                </div>
              </div>

              <div className="kw-actions" style={{ marginTop: "1rem" }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy}
                >
                  {busy
                    ? "Enregistrement…"
                    : releveCourant
                      ? "Mettre à jour"
                      : "Enregistrer"}
                </button>
                {preuve ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => setPreuve(null)}
                  >
                    Retirer la nouvelle image
                  </button>
                ) : null}
              </div>
            </form>
          </section>
        ) : null}

        <section className="panel kw-list" aria-label="Relevés du jour">
          <div className="kw-list-head">
            <h2>Relevés · {formatDateFr(date)}</h2>
            <p>
              {loading
                ? "…"
                : `${releves.length} enregistrement${releves.length > 1 ? "s" : ""}`}
            </p>
          </div>
          {loading ? (
            <BrandLoader variant="ligne" label="Chargement des relevés…" />
          ) : releves.length === 0 ? (
            <p className="kw-empty">Aucun relevé pour ce jour.</p>
          ) : (
            <div className="kw-table-wrap">
              <table className="kw-table">
                <thead>
                  <tr>
                    <th>Période</th>
                    {followAll ? <th>Site</th> : null}
                    <th>Courant restant</th>
                    <th>Par</th>
                    <th>Heure</th>
                    <th>Capture</th>
                    {canWrite ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {releves.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span
                          className={`kw-badge${r.periode === "soir" ? " is-soir" : ""}`}
                        >
                          {COMPTEUR_PERIODE_LABELS[r.periode]}
                        </span>
                      </td>
                      {followAll ? (
                        <td>{SITE_LABELS[r.site]}</td>
                      ) : null}
                      <td className="mono">{formatQuantite(r.quantite)}</td>
                      <td>{r.actorName}</td>
                      <td>{formatHeure(r.updatedAt || r.createdAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setLightbox(r.preuveUrl)}
                          aria-label="Voir la capture"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={r.preuveUrl}
                            alt=""
                            className="kw-thumb"
                          />
                        </button>
                      </td>
                      {canWrite ? (
                        <td>
                          {(siteLocked ? r.site === siteForForm : true) ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                setSite(r.site);
                                setPeriode(r.periode);
                                setQuantite(String(r.quantite));
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                            >
                              Modifier
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
