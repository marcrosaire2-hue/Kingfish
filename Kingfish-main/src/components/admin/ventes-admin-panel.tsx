"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { BrandLoader } from "@/components/brand-loader";
import { RegistreDrawer } from "@/components/registre-drawer";
import { formatFcfa } from "@/lib/format";
import { SITE_LABELS } from "@/lib/auth-types";
import {
  venteActionEnabled,
  type SiteRolesConfig,
} from "@/lib/site-roles-model";
import type { JournalVenteDay, JournalVenteLine } from "@/lib/ventes-history-repo";
import type { UserRole } from "@/lib/auth-types";

type CatalogItem = { id: string; name: string };
type VenteCatalog = {
  plat: CatalogItem[];
  local: CatalogItem[];
  boisson: CatalogItem[];
};

type EditForm = {
  date: string;
  time: string;
  productId: string;
  qty: string;
  unitPrice: string;
  description: string;
  reason: string;
};

function isoToLocalParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-CA", { timeZone: "Africa/Porto-Novo" });
  const time = d.toLocaleTimeString("fr-FR", {
    timeZone: "Africa/Porto-Novo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { date, time };
}

type SiteFilter = "all" | "zogbo" | "gbegamey";

const SITE_OPTIONS: [SiteFilter, string][] = [
  ["all", "Tous"],
  ["zogbo", "Zogbo"],
  ["gbegamey", "Gbégamey"],
];

const STATUT_OPTIONS = [
  ["all", "Tous"],
  ["valide", "Validé"],
  ["annule", "Annulé"],
  ["encours", "En cours"],
] as const;

const SOURCE_OPTIONS = [
  ["all", "Toutes"],
  ["kingfish", "King Fish"],
  ["aquapro", "AquaPro"],
] as const;

type Draft = {
  from: string;
  to: string;
  site: SiteFilter;
  statut: "all" | "valide" | "annule" | "encours";
  source: "all" | "kingfish" | "aquapro";
  q: string;
};

function todayIso(): string {
  const now = new Date();
  const tz = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - tz).toISOString().slice(0, 10);
}

function formatDateLong(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatHeure(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function siteLabel(site: string): string {
  if (site === "tous") return "Les deux sites";
  return SITE_LABELS[site as keyof typeof SITE_LABELS] ?? site;
}

function statutChip(l: JournalVenteDay["lines"][number]): string {
  return l.statutLabel || l.statut;
}

function vendeur(l: JournalVenteDay["lines"][number]): string {
  return l.caissier || l.serveur || "—";
}

export function VentesAdminPanel({
  userRole,
}: {
  userRole?: UserRole | null;
}) {
  const [draft, setDraft] = useState<Draft>({
    from: todayIso(),
    to: todayIso(),
    site: "all",
    statut: "all",
    source: "all",
    q: "",
  });
  const [applied, setApplied] = useState<Draft>(draft);
  const [days, setDays] = useState<JournalVenteDay[]>([]);
  const [totals, setTotals] = useState<{
    count: number;
    montant: number;
    valide: number;
    annule: number;
    encours: number;
  } | null>(null);
  const [sitePolicies, setSitePolicies] = useState<SiteRolesConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busyLineId, setBusyLineId] = useState<string | null>(null);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [canEditFull, setCanEditFull] = useState(false);
  const [catalog, setCatalog] = useState<VenteCatalog | null>(null);
  const [editing, setEditing] = useState<JournalVenteLine | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async (query: Draft) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        from: query.from,
        to: query.to,
        site: query.site,
        statut: query.statut,
        source: query.source,
      });
      if (query.q.trim()) params.set("q", query.q.trim());
      params.set("limit", "300");
      const res = await fetch(`/api/journal-ventes?${params}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Chargement impossible");
      setDays((body.days ?? []) as JournalVenteDay[]);
      setTotals(body.totals ?? null);
      if (body.sitePolicies) setSitePolicies(body.sitePolicies as SiteRolesConfig);
      setCanEditFull(!!body.canEditFull);
      if (body.catalog) setCatalog(body.catalog as VenteCatalog);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(applied);
  }, [applied, load]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 3500);
    return () => window.clearTimeout(timer);
  }, [flash]);

  function appliquer() {
    setApplied(draft);
  }

  function reinscrireFiltres() {
    const reset: Draft = {
      from: todayIso(),
      to: todayIso(),
      site: "all",
      statut: "all",
      source: "all",
      q: "",
    };
    setDraft(reset);
    setApplied(reset);
  }

  async function supprimerLigne(l: JournalVenteDay["lines"][number]) {
    if (!l.venteLogId) {
      setError("Cette ligne n'a pas de journal lié.");
      return;
    }
    if (
      !window.confirm(
        `Supprimer définitivement « ${l.produit} × ${l.qty} » (${formatFcfa(l.montant)}) ?\nStock, caisse et journal seront corrigés. Action irréversible.`,
      )
    ) {
      return;
    }
    setBusyLineId(l.venteLogId);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/vente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          id: l.venteLogId,
          date: l.date,
          site: l.site,
          reason: `Suppression espace admin : ${l.produit} × ${l.qty} (${l.numero})`,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Suppression impossible");
      setFlash(`« ${l.produit} × ${l.qty} » supprimé définitivement`);
      await load(applied);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible");
    } finally {
      setBusyLineId(null);
    }
  }

  async function supprimerTicket(l: JournalVenteDay["lines"][number]) {
    if (!l.ticketId) return;
    if (
      !window.confirm(
        `Supprimer définitivement le ticket ${l.numero} (${formatFcfa(l.montant)}) ?\nToutes ses lignes et la correction caisse suivront. Action irréversible.`,
      )
    ) {
      return;
    }
    setBusyTicketId(l.ticketId);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          id: l.ticketId,
          date: l.date,
          site: l.site,
          reason: `Suppression définitive du ticket ${l.numero}`,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Suppression impossible");
      setFlash(`Ticket ${l.numero} supprimé définitivement`);
      await load(applied);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible");
    } finally {
      setBusyTicketId(null);
    }
  }

  function ouvrirEdition(l: JournalVenteLine) {
    if (!l.venteLogId) return;
    const { time } = isoToLocalParts(l.at);
    setEditError(null);
    setEditing(l);
    setEditForm({
      date: l.date,
      time,
      productId: l.productId || "",
      qty: String(Math.abs(l.qty)),
      unitPrice: String(l.unitPrice),
      description: l.produit,
      reason: "",
    });
  }

  function fermerEdition() {
    setEditing(null);
    setEditForm(null);
    setEditError(null);
  }

  const editCatalogOptions = useMemo<CatalogItem[]>(() => {
    if (!editing || !editForm || !catalog) return [];
    const kind = editing.kind;
    if (kind !== "plat" && kind !== "local" && kind !== "boisson") return [];
    const list = catalog[kind] ?? [];
    if (
      editForm.productId &&
      !list.some((p) => p.id === editForm.productId)
    ) {
      return [
        { id: editForm.productId, name: `${editing.produit} (actuel)` },
        ...list,
      ];
    }
    return list;
  }, [editing, editForm, catalog]);

  async function enregistrerEdition(e: FormEvent) {
    e.preventDefault();
    if (!editing || !editForm || !editing.venteLogId) return;
    const qty = Number(editForm.qty);
    if (!Number.isFinite(qty) || qty < 1) {
      setEditError("Quantité invalide (minimum 1).");
      return;
    }
    if (editForm.reason.trim().length < 8) {
      setEditError("Motif d'audit requis (8 caractères minimum).");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const payload: Record<string, unknown> = {
        action: "edit-full",
        id: editing.venteLogId,
        date: editing.date,
        site: editing.site,
        newDate: editForm.date,
        newTime: editForm.time,
        qty,
        reason: editForm.reason.trim(),
      };
      if (editing.kind === "extra") {
        payload.description = editForm.description;
        payload.unitPrice = Number(editForm.unitPrice) || 0;
      } else if (editForm.productId) {
        payload.productId = editForm.productId;
      }
      const res = await fetch("/api/vente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Modification impossible");
      setFlash(
        `Vente « ${body.entry?.name ?? editing.produit} » modifiée avec précision`,
      );
      fermerEdition();
      await load(applied);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Modification impossible",
      );
    } finally {
      setEditBusy(false);
    }
  }

  const resume = useMemo(() => {
    if (!totals) return null;
    return [
      `${totals.count} ligne(s)`,
      `${totals.valide} validée(s)`,
      `${totals.annule} annulée(s)`,
      totals.encours ? `${totals.encours} en cours` : null,
      formatFcfa(totals.montant),
    ].filter(Boolean) as string[];
  }, [totals]);

  return (
    <div className="admin-ventes-panel">
      <p className="muted">
        Journal complet des ventes — passez les dates aux ventes du passé.
        Suppression définitive d'une ligne (ou d'un ticket entier) : le stock,
        le total caisse et le journal sont corrigés, et la suppression est
        tracée avec motif dans le Registre.
      </p>

      <div className="admin-form">
        <div className="admin-form-grid admin-form-grid-compact">
          <label className="admin-field">
            <span>Du</span>
            <input
              type="date"
              value={draft.from}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            />
          </label>
          <label className="admin-field">
            <span>Au</span>
            <input
              type="date"
              value={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            />
          </label>
          <label className="admin-field">
            <span>Site</span>
            <select
              className="select-input"
              value={draft.site}
              onChange={(e) =>
                setDraft((d) => ({ ...d, site: e.target.value as SiteFilter }))
              }
            >
              {SITE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Statut</span>
            <select
              className="select-input"
              value={draft.statut}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  statut: e.target.value as Draft["statut"],
                }))
              }
            >
              {STATUT_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Source</span>
            <select
              className="select-input"
              value={draft.source}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  source: e.target.value as Draft["source"],
                }))
              }
            >
              {SOURCE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Recherche</span>
            <input
              value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
              placeholder="Produit, client, n° ticket…"
              enterKeyHint="search"
            />
          </label>
          <div className="admin-field admin-field-actions">
            <button type="button" className="btn btn-primary" onClick={appliquer}>
              Appliquer
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={reinscrireFiltres}
            >
              Aujourd&apos;hui
            </button>
          </div>
        </div>
      </div>

      {flash ? (
        <p className="equipe-flash" role="status">
          {flash}
        </p>
      ) : null}
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {resume ? (
        <p className="admin-ventes-resume muted">{resume.join(" · ")}</p>
      ) : null}

      {loading ? (
        <BrandLoader variant="ligne" label="Chargement du journal…" />
      ) : days.length === 0 ? (
        <div className="equipe-empty">
          <strong>Aucune vente sur cette période.</strong>
          <p className="muted">
            Élargissez les dates ou effacez la recherche pour remonter aux
            ventes du passé.
          </p>
        </div>
      ) : (
        <div className="equipe-directory">
          {days.map((day) => {
            const dayTotal = day.lines.reduce(
              (s, l) => (l.statut === "valide" ? s + l.montant : s),
              0,
            );
            return (
              <section key={day.date} className="equipe-group">
                <header className="equipe-group-head">
                  <h2>{formatDateLong(day.date)}</h2>
                  <span>
                    {day.nbLignes} ligne(s) · {formatFcfa(dayTotal)}
                  </span>
                </header>
                <div className="table-scroll">
                  <table className="data-table jv-table">
                    <thead>
                      <tr>
                        <th scope="col">Heure</th>
                        <th scope="col">Ticket</th>
                        <th scope="col">Site</th>
                        <th scope="col">Produit</th>
                        <th scope="col">Enregistré par</th>
                        <th scope="col" className="col-money">
                          Qté
                        </th>
                        <th scope="col" className="col-money">
                          Montant
                        </th>
                        <th scope="col">Statut</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.lines.map((l, i) => {
                        const key = `${l.date}-${l.at}-${l.venteLogId ?? i}`;
                        const suppressionOk =
                          l.venteLogId &&
                          venteActionEnabled(
                            sitePolicies,
                            userRole,
                            l.site,
                            "delete",
                          );
                        return (
                          <tr key={key}>
                            <td>{formatHeure(l.at)}</td>
                            <td className="cell-name">
                              <strong>{l.numero}</strong>
                              {l.client ? (
                                <span className="cell-sub">{l.client}</span>
                              ) : null}
                            </td>
                            <td>{siteLabel(l.site)}</td>
                            <td className="cell-name">
                              <strong>{l.produit}</strong>
                            </td>
                            <td>{vendeur(l)}</td>
                            <td className="mono col-money">{l.qty}</td>
                            <td className="mono col-money">
                              {formatFcfa(l.montant)}
                            </td>
                            <td>
                              <span className={`hist-statut hist-statut-${l.statut}`}>
                                {statutChip(l)}
                              </span>
                            </td>
                            <td>
                              <span className="reg-actions">
                                {canEditFull &&
                                l.venteLogId &&
                                l.statut === "valide" ? (
                                  <button
                                    type="button"
                                    className="btn-link"
                                    onClick={() => ouvrirEdition(l)}
                                  >
                                    Modifier
                                  </button>
                                ) : null}
                                {suppressionOk ? (
                                  <>
                                    {l.venteLogId ? (
                                      <button
                                        type="button"
                                        className="btn-link btn-link-danger"
                                        disabled={
                                          busyLineId === l.venteLogId ||
                                          busyTicketId === l.ticketId
                                        }
                                        onClick={() => void supprimerLigne(l)}
                                      >
                                        {busyLineId === l.venteLogId
                                          ? "…"
                                          : "Supprimer"}
                                      </button>
                                    ) : null}
                                    {l.ticketId ? (
                                      <button
                                        type="button"
                                        className="btn-link"
                                        disabled={
                                          busyTicketId === l.ticketId ||
                                          busyLineId === l.venteLogId
                                        }
                                        onClick={() => void supprimerTicket(l)}
                                      >
                                        {busyTicketId === l.ticketId
                                          ? "…"
                                          : "Tout le ticket"}
                                      </button>
                                    ) : null}
                                  </>
                                ) : (
                                  <span className="cell-sub">
                                    Suppression désactivée par la matrice
                                  </span>
                                )}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <RegistreDrawer
        open={!!editing}
        onClose={fermerEdition}
        title="Modifier une vente"
        subtitle={
          editing
            ? `${editing.produit} · ${siteLabel(editing.site)} · ${editing.numero}`
            : undefined
        }
        closeLabel="Fermer la modification de vente"
      >
        {editing && editForm ? (
          <form className="admin-form" onSubmit={enregistrerEdition}>
            {editError ? (
              <p className="error-banner" role="alert">
                {editError}
              </p>
            ) : null}
            <div className="admin-form-grid admin-form-grid-compact">
              <label className="admin-field">
                <span>Jour</span>
                <input
                  type="date"
                  value={editForm.date}
                  onChange={(e) =>
                    setEditForm((f) => (f ? { ...f, date: e.target.value } : f))
                  }
                  required
                />
              </label>
              <label className="admin-field">
                <span>Heure précise</span>
                <input
                  type="time"
                  value={editForm.time}
                  onChange={(e) =>
                    setEditForm((f) => (f ? { ...f, time: e.target.value } : f))
                  }
                  required
                />
              </label>
              {editing.kind && editing.kind !== "extra" ? (
                <label className="admin-field admin-field-full">
                  <span>Produit</span>
                  <select
                    className="select-input"
                    value={editForm.productId}
                    onChange={(e) =>
                      setEditForm((f) =>
                        f ? { ...f, productId: e.target.value } : f,
                      )
                    }
                  >
                    {editCatalogOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="admin-field admin-field-full">
                    <span>Libellé</span>
                    <input
                      value={editForm.description}
                      onChange={(e) =>
                        setEditForm((f) =>
                          f ? { ...f, description: e.target.value } : f,
                        )
                      }
                    />
                  </label>
                  <label className="admin-field">
                    <span>Prix unitaire (FCFA)</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={editForm.unitPrice}
                      onChange={(e) =>
                        setEditForm((f) =>
                          f ? { ...f, unitPrice: e.target.value } : f,
                        )
                      }
                    />
                  </label>
                </>
              )}
              <label className="admin-field">
                <span>Quantité</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={editForm.qty}
                  onChange={(e) =>
                    setEditForm((f) => (f ? { ...f, qty: e.target.value } : f))
                  }
                  required
                />
              </label>
              <label className="admin-field admin-field-full">
                <span>Motif de la correction</span>
                <input
                  value={editForm.reason}
                  onChange={(e) =>
                    setEditForm((f) => (f ? { ...f, reason: e.target.value } : f))
                  }
                  placeholder="ex. Erreur de saisie caisse, corrigé à la demande de…"
                  minLength={8}
                  required
                />
              </label>
            </div>
            <p className="muted">
              Correction admin : stock, montant et journal sont recalculés.
              Si le jour ou le produit changent, le ticket POS d&apos;origine
              n&apos;est plus lié à cette ligne — la vente reste tracée dans
              le journal, comme les ventes carnet et AquaPro.
            </p>
            <div className="equipe-create-actions">
              <button type="submit" className="btn btn-primary" disabled={editBusy}>
                {editBusy ? "Enregistrement…" : "Enregistrer la correction"}
              </button>
            </div>
          </form>
        ) : null}
      </RegistreDrawer>
    </div>
  );
}
