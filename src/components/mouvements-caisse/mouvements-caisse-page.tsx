"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { useSession } from "@/components/session-provider";
import {
  CAISSE_LABELS,
  CAISSE_SHORT_LABELS,
  CAISSE_STATUT_LABELS,
  estSortieCaisse,
} from "@/lib/caisse-model";
import { formatFcfa } from "@/lib/format";
import type {
  CaisseKey,
  CaisseMouvement,
  CaisseSession,
  CaisseSoldeTotaux,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import "./mouvements-caisse-page.css";

type SiteDetail = {
  caisse: "zogbo" | "gbegamey";
  session: CaisseSession | null;
  totaux: CaisseSoldeTotaux | null;
  soldeCourant: number;
};

type JournalRow = CaisseMouvement & {
  caisse: CaisseKey;
  sessionDate: string;
};

type Board = {
  dateFrom: string;
  dateTo: string;
  sites: Array<"zogbo" | "gbegamey">;
  soldeGlobal: number;
  sitesDetail: SiteDetail[];
  mouvements: JournalRow[];
};

const KIND_LABELS: Record<CaisseMouvement["kind"], string> = {
  depense: "Dépense / achat",
  recette: "Recette",
  "versement-sortie": "Versement sorti",
  "versement-entree": "Versement",
};

type KindFilter = "tous" | "depense" | "versement-entree" | "recette";
type SiteFilter = "tous" | "zogbo" | "gbegamey";

function monthStart(d = todayIsoDate()) {
  return `${d.slice(0, 7)}-01`;
}

function formatAt(iso: string) {
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

export function MouvementsCaissePage() {
  const { user, ready } = useSession();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(todayIsoDate);
  const [siteFilter, setSiteFilter] = useState<SiteFilter>("tous");
  const [kindFilter, setKindFilter] = useState<KindFilter>("tous");
  const [query, setQuery] = useState("");

  const [capitalZogbo, setCapitalZogbo] = useState("");
  const [capitalGbegamey, setCapitalGbegamey] = useState("");
  const [capitalDate, setCapitalDate] = useState(todayIsoDate);

  const [fondsCaisse, setFondsCaisse] = useState<"zogbo" | "gbegamey" | "">("");
  const [fondsMode, setFondsMode] = useState<"ajouter" | "modifier">("ajouter");
  const [fondsMontant, setFondsMontant] = useState("");
  const [fondsDate, setFondsDate] = useState(todayIsoDate);
  const [fondsMotif, setFondsMotif] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/mouvements-caisse?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setBoard(body as Board);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (!ready) return;
    if (user?.role !== "admin") {
      setLoading(false);
      setError("Accès réservé à l'administrateur.");
      return;
    }
    void load();
  }, [ready, user?.role, load]);

  async function post(corps: Record<string, unknown>, echec: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/mouvements-caisse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || echec);
      await load();
      return body;
    } catch (e) {
      setError(e instanceof Error ? e.message : echec);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function enregistrerCapitaux() {
    const capitaux: Partial<Record<"zogbo" | "gbegamey", number>> = {};
    const sites = board?.sites ?? ["zogbo", "gbegamey"];
    if (sites.includes("zogbo")) {
      capitaux.zogbo = Math.max(0, Math.round(Number(capitalZogbo) || 0));
    }
    if (sites.includes("gbegamey")) {
      capitaux.gbegamey = Math.max(0, Math.round(Number(capitalGbegamey) || 0));
    }
    const ok = await post(
      {
        action: "open-capitaux",
        date: capitalDate || todayIsoDate(),
        capitaux,
      },
      "Échec enregistrement des capitaux",
    );
    if (ok) {
      setFlash("Capitaux initiaux enregistrés.");
      setCapitalZogbo("");
      setCapitalGbegamey("");
    }
  }

  async function appliquerCapital() {
    if (!fondsCaisse) return;
    const montant = Math.round(Number(fondsMontant) || 0);
    const date = fondsDate || todayIsoDate();
    const detail = detailByCaisse.get(fondsCaisse);
    const avant = detail?.session?.soldeInitial ?? 0;

    if (fondsMode === "ajouter") {
      if (montant <= 0) {
        setError("Indiquez un montant positif à ajouter au capital.");
        return;
      }
      const recap = [
        `Ajouter des fonds à ${CAISSE_LABELS[fondsCaisse]} ?`,
        "",
        `Capital actuel : ${formatFcfa(avant)}`,
        `Fonds à ajouter : +${formatFcfa(montant)}`,
        `Nouveau capital : ${formatFcfa(avant + montant)}`,
        `Date d'effet : ${date}`,
      ].join("\n");
      if (!window.confirm(recap)) return;

      const ok = await post(
        {
          action: "add-fonds",
          caisse: fondsCaisse,
          montant,
          date,
          motif: fondsMotif.trim() || null,
        },
        "Échec ajout de fonds",
      );
      if (ok) {
        setFlash(
          `+${formatFcfa(montant)} ajoutés au capital ${CAISSE_SHORT_LABELS[fondsCaisse]} (effet ${date}).`,
        );
        setFondsMontant("");
        setFondsMotif("");
        setFondsDate(todayIsoDate());
      }
      return;
    }

    // Modifier = remplacer entièrement le capital
    if (montant < 0) {
      setError("Le capital ne peut pas être négatif.");
      return;
    }
    const recap = [
      `Remplacer le capital de ${CAISSE_LABELS[fondsCaisse]} ?`,
      "",
      `Capital actuel : ${formatFcfa(avant)}`,
      `Nouveau capital : ${formatFcfa(montant)}`,
      `Date d'effet : ${date}`,
      "",
      "Ce montant devient le capital initial à cette date.",
    ].join("\n");
    if (!window.confirm(recap)) return;

    const ok = await post(
      {
        action: "set-capital",
        caisse: fondsCaisse,
        soldeInitial: montant,
        date,
        motif: fondsMotif.trim() || null,
      },
      "Échec modification du capital",
    );
    if (ok) {
      setFlash(
        `Capital ${CAISSE_SHORT_LABELS[fondsCaisse]} fixé à ${formatFcfa(montant)} (effet ${date}).`,
      );
      setFondsMontant("");
      setFondsMotif("");
      setFondsDate(todayIsoDate());
    }
  }

  const detailByCaisse = useMemo(() => {
    const map = new Map<string, SiteDetail>();
    for (const d of board?.sitesDetail ?? []) map.set(d.caisse, d);
    return map;
  }, [board?.sitesDetail]);

  const aOuvrir = (board?.sites ?? []).filter(
    (c) => !detailByCaisse.get(c)?.session,
  );

  const journal = useMemo(() => {
    let rows = board?.mouvements ?? [];
    if (siteFilter !== "tous") {
      rows = rows.filter((m) => m.caisse === siteFilter);
    }
    if (kindFilter !== "tous") {
      rows = rows.filter((m) => m.kind === kindFilter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (m) =>
          m.nature.toLowerCase().includes(q) ||
          m.beneficiaire.toLowerCase().includes(q) ||
          (m.actorName ?? "").toLowerCase().includes(q) ||
          KIND_LABELS[m.kind].toLowerCase().includes(q),
      );
    }
    return [...rows].reverse();
  }, [board?.mouvements, siteFilter, kindFilter, query]);

  if (ready && user && user.role !== "admin") {
    return (
      <AppShell title="Mouvements de fonds" subtitle="Accès restreint">
        <p className="error-banner" role="alert">
          Accès réservé à l&apos;administrateur.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Mouvements de fonds"
      subtitle="Capital des sites · consultation des flux opérationnels"
    >
      <div className="mcaisse-page">
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}
        {flash ? (
          <p className="ui-info" role="status">
            {flash}
          </p>
        ) : null}

        {loading && !board ? (
          <BrandLoader label="Chargement des caisses…" />
        ) : null}
        {busy ? (
          <BrandLoader variant="voile" label="Opération en cours…" />
        ) : null}

        {board ? (
          <>
            <section className="mcaisse-stage">
              <p className="mcaisse-stage-kicker">Pilotage · multi-sites</p>
              <h2>Fonds &amp; capital</h2>
              <p>
                Ajoutez ou corrigez le capital de chaque site. Les versements,
                achats et dépenses restent saisis par les équipes en Caisse /
                Dépenses.
              </p>
            </section>

            <section className="mcaisse-kpis" aria-label="Soldes par site">
              {board.sitesDetail.map((d) => (
                <article
                  key={d.caisse}
                  className="mcaisse-kpi"
                  data-site={d.caisse}
                >
                  <header>
                    <h2>{CAISSE_LABELS[d.caisse]}</h2>
                    <span
                      className={`mcaisse-pill${d.session ? " is-open" : ""}`}
                    >
                      {d.session
                        ? CAISSE_STATUT_LABELS[d.session.statut]
                        : "Fermée"}
                    </span>
                  </header>
                  <strong className="mono">
                    {d.session ? formatFcfa(d.soldeCourant) : "—"}
                  </strong>
                  <dl>
                    <div>
                      <dt>Capital</dt>
                      <dd className="mono">
                        {d.session
                          ? formatFcfa(d.session.soldeInitial)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Depuis le</dt>
                      <dd className="mono">
                        {d.session ? d.session.date : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Versements</dt>
                      <dd className="mono text-ok">
                        {d.totaux
                          ? `+${formatFcfa(d.totaux.totalEntrees)}`
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Sorties</dt>
                      <dd className="mono text-danger">
                        {d.totaux
                          ? `−${formatFcfa(d.totaux.totalSorties)}`
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
              <article className="mcaisse-kpi mcaisse-kpi-global">
                <header>
                  <h2>Solde global</h2>
                </header>
                <strong className="mono">{formatFcfa(board.soldeGlobal)}</strong>
                <p className="muted" style={{ margin: "0.35rem 0 0", paddingLeft: "0.35rem" }}>
                  Somme des soldes · flux non mélangés
                </p>
              </article>
            </section>

            {aOuvrir.length > 0 ? (
              <section className="mcaisse-panel">
                <header className="mcaisse-panel-head">
                  <span className="mcaisse-step" aria-hidden>
                    1
                  </span>
                  <div>
                    <h2>Capital initial</h2>
                    <p>
                      Fixez le fond de départ de chaque site à l&apos;ouverture.
                    </p>
                  </div>
                </header>
                <div className="mcaisse-capital-grid">
                  <label className="mcaisse-field">
                    <span>Date d&apos;effet</span>
                    <input
                      type="date"
                      value={capitalDate}
                      onChange={(e) => setCapitalDate(e.target.value)}
                    />
                  </label>
                  {aOuvrir.includes("zogbo") ? (
                    <label className="mcaisse-field">
                      <span>Capital Zogbo (FCFA)</span>
                      <input
                        type="number"
                        min={0}
                        value={capitalZogbo}
                        onChange={(e) => setCapitalZogbo(e.target.value)}
                        placeholder="0"
                      />
                    </label>
                  ) : null}
                  {aOuvrir.includes("gbegamey") ? (
                    <label className="mcaisse-field">
                      <span>Capital Gbégamey (FCFA)</span>
                      <input
                        type="number"
                        min={0}
                        value={capitalGbegamey}
                        onChange={(e) => setCapitalGbegamey(e.target.value)}
                        placeholder="0"
                      />
                    </label>
                  ) : null}
                </div>
                <div className="mcaisse-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void enregistrerCapitaux()}
                  >
                    Enregistrer le capital initial
                  </button>
                </div>
              </section>
            ) : null}

            <section className="mcaisse-panel">
              <header className="mcaisse-panel-head">
                <span className="mcaisse-step" aria-hidden>
                  {aOuvrir.length > 0 ? "2" : "1"}
                </span>
                <div>
                  <h2>Gérer le capital</h2>
                  <p>
                    Ajouter des fonds ou remplacer entièrement le capital d&apos;un
                    site.
                  </p>
                </div>
              </header>
              <div
                className="mcaisse-kind-switch"
                role="tablist"
                aria-label="Mode capital"
              >
                <button
                  type="button"
                  className={`mcaisse-kind-btn${fondsMode === "ajouter" ? " is-active is-in" : ""}`}
                  onClick={() => {
                    setFondsMode("ajouter");
                    setFondsMontant("");
                  }}
                >
                  Ajouter des fonds
                </button>
                <button
                  type="button"
                  className={`mcaisse-kind-btn${fondsMode === "modifier" ? " is-active is-out" : ""}`}
                  onClick={() => {
                    setFondsMode("modifier");
                    if (fondsCaisse) {
                      const s = detailByCaisse.get(fondsCaisse)?.session;
                      setFondsMontant(s ? String(s.soldeInitial) : "");
                    } else {
                      setFondsMontant("");
                    }
                  }}
                >
                  Modifier le capital
                </button>
              </div>
              <div className="mcaisse-form-grid">
                <label className="mcaisse-field">
                  <span>Site</span>
                  <select
                    value={fondsCaisse}
                    onChange={(e) => {
                      const c = e.target.value as "zogbo" | "gbegamey" | "";
                      setFondsCaisse(c);
                      if (fondsMode === "modifier" && c) {
                        const s = detailByCaisse.get(c)?.session;
                        setFondsMontant(s ? String(s.soldeInitial) : "");
                        setFondsDate(s?.date || todayIsoDate());
                      }
                    }}
                  >
                    <option value="">Choisir…</option>
                    {board.sites.map((c) => (
                      <option key={c} value={c}>
                        {CAISSE_SHORT_LABELS[c]}
                        {detailByCaisse.get(c)?.session
                          ? ` · capital ${formatFcfa(detailByCaisse.get(c)!.session!.soldeInitial)}`
                          : " · fermée (sera ouverte)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mcaisse-field">
                  <span>
                    {fondsMode === "ajouter"
                      ? "Fonds à ajouter (FCFA)"
                      : "Nouveau capital (FCFA)"}
                  </span>
                  <input
                    type="number"
                    min={fondsMode === "ajouter" ? 1 : 0}
                    value={fondsMontant}
                    onChange={(e) => setFondsMontant(e.target.value)}
                    placeholder="0"
                    disabled={!fondsCaisse}
                  />
                </label>
                <label className="mcaisse-field">
                  <span>Date d&apos;effet</span>
                  <input
                    type="date"
                    value={fondsDate}
                    onChange={(e) => setFondsDate(e.target.value)}
                    disabled={!fondsCaisse}
                  />
                </label>
                <label className="mcaisse-field">
                  <span>Motif (optionnel)</span>
                  <input
                    value={fondsMotif}
                    onChange={(e) => setFondsMotif(e.target.value)}
                    placeholder={
                      fondsMode === "ajouter"
                        ? "Ex. apport direction…"
                        : "Ex. correction fond de caisse…"
                    }
                    disabled={!fondsCaisse}
                  />
                </label>
              </div>
              <div className="mcaisse-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !fondsCaisse || fondsMontant === ""}
                  onClick={() => void appliquerCapital()}
                >
                  {fondsMode === "ajouter"
                    ? "Ajouter au capital"
                    : "Remplacer le capital"}
                </button>
              </div>
            </section>

            <section className="mcaisse-panel">
              <header className="mcaisse-panel-head">
                <span className="mcaisse-step" aria-hidden>
                  {aOuvrir.length > 0 ? "3" : "2"}
                </span>
                <div>
                  <h2>Journal des deux sites</h2>
                  <p>
                    Consultation seule · {journal.length} ligne
                    {journal.length > 1 ? "s" : ""}
                  </p>
                </div>
              </header>

              <div className="mcaisse-filters">
                <label className="mcaisse-field">
                  <span>Du</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </label>
                <label className="mcaisse-field">
                  <span>Au</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </label>
                <label className="mcaisse-field">
                  <span>Site</span>
                  <select
                    value={siteFilter}
                    onChange={(e) =>
                      setSiteFilter(e.target.value as SiteFilter)
                    }
                  >
                    <option value="tous">Tous</option>
                    {board.sites.map((c) => (
                      <option key={c} value={c}>
                        {CAISSE_SHORT_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mcaisse-field">
                  <span>Type</span>
                  <select
                    value={kindFilter}
                    onChange={(e) =>
                      setKindFilter(e.target.value as KindFilter)
                    }
                  >
                    <option value="tous">Tous</option>
                    <option value="versement-entree">Versements</option>
                    <option value="depense">Dépenses</option>
                    <option value="recette">Recettes</option>
                  </select>
                </label>
                <label className="mcaisse-field mcaisse-search">
                  <span>Recherche</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Motif, bénéficiaire…"
                  />
                </label>
              </div>

              {!journal.length ? (
                <p className="mcaisse-empty">
                  Aucun mouvement sur cette période.
                </p>
              ) : (
                <div className="mcaisse-table-wrap">
                  <table className="data-table mcaisse-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Site</th>
                        <th>Type</th>
                        <th>Motif</th>
                        <th className="col-money">Montant</th>
                        <th className="col-money">Avant</th>
                        <th className="col-money">Après</th>
                        <th>Par</th>
                      </tr>
                    </thead>
                    <tbody>
                      {journal.map((m) => (
                        <tr
                          key={m.id}
                          className={m.cancelledAt ? "is-cancelled" : undefined}
                        >
                          <td>{formatAt(m.at)}</td>
                          <td>{CAISSE_SHORT_LABELS[m.caisse]}</td>
                          <td>{KIND_LABELS[m.kind]}</td>
                          <td>
                            {m.nature}
                            {m.beneficiaire && m.beneficiaire !== "—"
                              ? ` · ${m.beneficiaire}`
                              : ""}
                            {m.cancelledAt ? " · annulé" : ""}
                          </td>
                          <td
                            className={`mono col-money ${estSortieCaisse(m.kind) ? "text-danger" : "text-ok"}`}
                          >
                            {estSortieCaisse(m.kind) ? "−" : "+"}
                            {formatFcfa(m.montant)}
                          </td>
                          <td className="mono col-money">
                            {m.soldeAvant != null
                              ? formatFcfa(m.soldeAvant)
                              : "—"}
                          </td>
                          <td className="mono col-money">
                            {m.soldeApres != null
                              ? formatFcfa(m.soldeApres)
                              : "—"}
                          </td>
                          <td>{m.actorName ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
