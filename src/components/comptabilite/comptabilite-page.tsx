"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  DashKpiGrid,
  DashboardShell,
  DashboardToolbar,
} from "@/components/dashboard/dashboard-layout";
import { BrandLoader } from "@/components/brand-loader";
import { ExportExcelButton } from "@/components/export-excel-button";
import { formatFcfa } from "@/lib/format";
import type {
  CompteGrandLivre,
  EcritureComptable,
  LigneBalance,
} from "@/lib/journal-comptable-calc";
import {
  exportBalanceExcel,
  exportBilanExcel,
  exportGrandLivreExcel,
  exportJournalComptableExcel,
} from "@/lib/page-exports";
import { todayIsoDate } from "@/lib/zogbo-calc";

type Anomalie = { date: string; message: string };
type Onglet = "journal" | "grand-livre" | "balance" | "bilan";

function monthStartIso(d = todayIsoDate()): string {
  return `${d.slice(0, 7)}-01`;
}

const ONGLETS: { key: Onglet; label: string }[] = [
  { key: "journal", label: "Journal" },
  { key: "grand-livre", label: "Grand livre" },
  { key: "balance", label: "Balance" },
  { key: "bilan", label: "Bilan" },
];

export function ComptabilitePage() {
  const [onglet, setOnglet] = useState<Onglet>("journal");
  const [from, setFrom] = useState(() => monthStartIso());
  const [to, setTo] = useState(() => todayIsoDate());
  const [asOf, setAsOf] = useState(() => todayIsoDate());
  const [site, setSite] = useState<"zogbo" | "gbegamey">("zogbo");

  return (
    <AppShell
      title="Comptabilité"
      subtitle={`Journal, grand livre, balance et bilan — site ${site === "zogbo" ? "Zogbo" : "Gbégamey"} (indépendant).`}
    >
      <DashboardShell>
      <DashboardToolbar
        tabs={ONGLETS.map((o) => ({ id: o.key, label: o.label }))}
        activeTab={onglet}
        onTabChange={(id) => setOnglet(id as Onglet)}
        tabListLabel="Vue comptable"
        filters={
          <div className="site-switch" role="tablist" aria-label="Site">
            {(["zogbo", "gbegamey"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={site === s}
                className={`site-btn${site === s ? " is-active" : ""}`}
                onClick={() => setSite(s)}
              >
                {s === "zogbo" ? "Zogbo" : "Gbégamey"}
              </button>
            ))}
          </div>
        }
      />

      {onglet === "journal" ? (
        <JournalView from={from} to={to} setFrom={setFrom} setTo={setTo} site={site} />
      ) : null}
      {onglet === "grand-livre" ? (
        <GrandLivreView from={from} to={to} setFrom={setFrom} setTo={setTo} site={site} />
      ) : null}
      {onglet === "balance" ? (
        <BalanceView from={from} to={to} setFrom={setFrom} setTo={setTo} site={site} />
      ) : null}
      {onglet === "bilan" ? (
        <BilanView asOf={asOf} setAsOf={setAsOf} site={site} />
      ) : null}
      </DashboardShell>
    </AppShell>
  );
}

function PeriodeFilters({
  from,
  to,
  setFrom,
  setTo,
  onRefresh,
  loading,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <div className="hist-filters">
      <label className="date-field">
        <span>Du</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="date-field">
        <span>Au</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onRefresh}
        disabled={loading}
      >
        Actualiser
      </button>
    </div>
  );
}

type JournalResult = {
  from: string;
  to: string;
  ecritures: EcritureComptable[];
  totalDebit: number;
  totalCredit: number;
  equilibre: boolean;
  aReclasser: EcritureComptable[];
  anomalies: Anomalie[];
  pertesExclues: { montant: number; note: string };
};

const EMPTY_JOURNAL: JournalResult = {
  from: "",
  to: "",
  ecritures: [],
  totalDebit: 0,
  totalCredit: 0,
  equilibre: true,
  aReclasser: [],
  anomalies: [],
  pertesExclues: { montant: 0, note: "" },
};

function JournalView({
  from,
  to,
  setFrom,
  setTo,
  site,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  site: "zogbo" | "gbegamey";
}) {
  const [result, setResult] = useState<JournalResult>(EMPTY_JOURNAL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyAReclasser, setOnlyAReclasser] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ view: "journal", from, to, site });
      const res = await fetch(`/api/comptabilite?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setResult(body as JournalResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setResult(EMPTY_JOURNAL);
    } finally {
      setLoading(false);
    }
  }, [from, to, site]);

  useEffect(() => {
    void load();
  }, [load]);

  const lignesAffichees = onlyAReclasser ? result.aReclasser : result.ecritures;

  return (
    <>
      <PeriodeFilters from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={() => void load()} loading={loading} />
      <div className="dash-ca-final hist-ventes-totaux">
        <ExportExcelButton
          onExport={() =>
            exportJournalComptableExcel({
              from: result.from || from,
              to: result.to || to,
              ecritures: result.ecritures,
              totalDebit: result.totalDebit,
              totalCredit: result.totalCredit,
              equilibre: result.equilibre,
              anomalies: result.anomalies,
              pertesExclues: result.pertesExclues,
            })
          }
          disabled={loading || result.ecritures.length === 0}
        />
      </div>

      {error ? <p className="error-banner" role="alert">{error}</p> : null}

      {loading ? (
        <BrandLoader variant="ligne" label="Construction du journal…" />
      ) : (
        <>
          <div className="dash-kpi-grid">
            <div className="dash-kpi">
              <span className="dash-kpi-label">Total débit</span>
              <span className="dash-kpi-value">{formatFcfa(result.totalDebit)}</span>
            </div>
            <div className="dash-kpi">
              <span className="dash-kpi-label">Total crédit</span>
              <span className="dash-kpi-value">{formatFcfa(result.totalCredit)}</span>
            </div>
            <div className={`dash-kpi${result.equilibre ? "" : " dash-kpi-warn"}`}>
              <span className="dash-kpi-label">Équilibre</span>
              <span className="dash-kpi-value">{result.equilibre ? "OK" : "Déséquilibré"}</span>
            </div>
            <div className={`dash-kpi${result.aReclasser.length > 0 ? " dash-kpi-warn" : ""}`}>
              <span className="dash-kpi-label">Lignes à vérifier</span>
              <span className="dash-kpi-value">{result.aReclasser.length}</span>
            </div>
          </div>

          {result.pertesExclues.montant > 0 ? (
            <p className="ui-info" role="note">
              Pertes de la période ({formatFcfa(result.pertesExclues.montant)}) : {result.pertesExclues.note}
            </p>
          ) : null}

          {result.anomalies.length > 0 ? (
            <section className="panel">
              <h2 className="panel-title">Anomalies détectées</h2>
              <ul>
                {result.anomalies.map((a, i) => (
                  <li key={i}>
                    <strong>{a.date}</strong> — {a.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="panel panel-wide">
            <div className="panel-head">
              <h2 className="panel-title">
                Écritures
                <span className="jv-day-head-count">
                  {lignesAffichees.length} ligne{lignesAffichees.length > 1 ? "s" : ""}
                </span>
              </h2>
              <label className="muted">
                <input
                  type="checkbox"
                  checked={onlyAReclasser}
                  onChange={(e) => setOnlyAReclasser(e.target.checked)}
                />{" "}
                Afficher seulement les lignes à vérifier
              </label>
            </div>
            {lignesAffichees.length === 0 ? (
              <p className="muted">Aucune écriture pour ces filtres.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Pièce</th>
                      <th scope="col">Compte</th>
                      <th scope="col">Libellé compte</th>
                      <th scope="col">Libellé</th>
                      <th scope="col" className="col-money">Débit</th>
                      <th scope="col" className="col-money">Crédit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignesAffichees.map((e, i) => (
                      <tr key={`${e.piece}-${e.compte}-${i}`} className={e.confiant ? undefined : "row-warn"}>
                        <td className="mono">{e.date}</td>
                        <td>{e.piece}</td>
                        <td className="mono">{e.compte}</td>
                        <td>{e.compteLibelle}</td>
                        <td>
                          {e.libelle}
                          {!e.confiant ? <span className="muted"> · à vérifier</span> : null}
                        </td>
                        <td className="mono col-money">{e.debit ? formatFcfa(e.debit) : ""}</td>
                        <td className="mono col-money">{e.credit ? formatFcfa(e.credit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function GrandLivreView({
  from,
  to,
  setFrom,
  setTo,
  site,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  site: "zogbo" | "gbegamey";
}) {
  const [comptes, setComptes] = useState<CompteGrandLivre[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ view: "grand-livre", from, to, site });
      const res = await fetch(`/api/comptabilite?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setComptes((body.comptes as CompteGrandLivre[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setComptes([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, site]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PeriodeFilters from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={() => void load()} loading={loading} />
      <div className="dash-ca-final hist-ventes-totaux">
        <ExportExcelButton
          onExport={() => exportGrandLivreExcel({ from, to, comptes })}
          disabled={loading || comptes.length === 0}
        />
      </div>
      {error ? <p className="error-banner" role="alert">{error}</p> : null}
      {loading ? (
        <BrandLoader variant="ligne" label="Construction du grand livre…" />
      ) : comptes.length === 0 ? (
        <p className="muted">Aucun mouvement pour ces filtres.</p>
      ) : (
        comptes.map((c) => (
          <section key={c.compte} className="panel panel-wide">
            <div className="panel-head">
              <h2 className="panel-title">
                {c.compte} — {c.compteLibelle}
              </h2>
              <strong className="mono">Solde : {formatFcfa(c.soldeFinal)}</strong>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Pièce</th>
                    <th scope="col">Libellé</th>
                    <th scope="col" className="col-money">Débit</th>
                    <th scope="col" className="col-money">Crédit</th>
                    <th scope="col" className="col-money">Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {c.mouvements.map((m, i) => (
                    <tr key={i}>
                      <td className="mono">{m.date}</td>
                      <td>{m.piece}</td>
                      <td>{m.libelle}</td>
                      <td className="mono col-money">{m.debit ? formatFcfa(m.debit) : ""}</td>
                      <td className="mono col-money">{m.credit ? formatFcfa(m.credit) : ""}</td>
                      <td className="mono col-money">{formatFcfa(m.solde)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3}>Total</th>
                    <td className="mono col-money">{formatFcfa(c.totalDebit)}</td>
                    <td className="mono col-money">{formatFcfa(c.totalCredit)}</td>
                    <td className="mono col-money">{formatFcfa(c.soldeFinal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        ))
      )}
    </>
  );
}

function BalanceView({
  from,
  to,
  setFrom,
  setTo,
  site,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  site: "zogbo" | "gbegamey";
}) {
  const [lignes, setLignes] = useState<LigneBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ view: "balance", from, to, site });
      const res = await fetch(`/api/comptabilite?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setLignes((body.lignes as LigneBalance[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setLignes([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, site]);

  useEffect(() => {
    void load();
  }, [load]);

  const totaux = lignes.reduce(
    (acc, l) => ({
      debit: acc.debit + l.debit,
      credit: acc.credit + l.credit,
      soldeDebiteur: acc.soldeDebiteur + l.soldeDebiteur,
      soldeCrediteur: acc.soldeCrediteur + l.soldeCrediteur,
    }),
    { debit: 0, credit: 0, soldeDebiteur: 0, soldeCrediteur: 0 },
  );

  return (
    <>
      <PeriodeFilters from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={() => void load()} loading={loading} />
      <div className="dash-ca-final hist-ventes-totaux">
        <ExportExcelButton
          onExport={() => exportBalanceExcel({ from, to, lignes })}
          disabled={loading || lignes.length === 0}
        />
      </div>
      {error ? <p className="error-banner" role="alert">{error}</p> : null}
      {loading ? (
        <BrandLoader variant="ligne" label="Construction de la balance…" />
      ) : (
        <section className="panel panel-wide">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Compte</th>
                  <th scope="col">Libellé</th>
                  <th scope="col" className="col-money">Débit</th>
                  <th scope="col" className="col-money">Crédit</th>
                  <th scope="col" className="col-money">Solde débiteur</th>
                  <th scope="col" className="col-money">Solde créditeur</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.compte}>
                    <td className="mono">{l.compte}</td>
                    <td>{l.compteLibelle}</td>
                    <td className="mono col-money">{formatFcfa(l.debit)}</td>
                    <td className="mono col-money">{formatFcfa(l.credit)}</td>
                    <td className="mono col-money">{l.soldeDebiteur ? formatFcfa(l.soldeDebiteur) : ""}</td>
                    <td className="mono col-money">{l.soldeCrediteur ? formatFcfa(l.soldeCrediteur) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>Total</th>
                  <td className="mono col-money">{formatFcfa(totaux.debit)}</td>
                  <td className="mono col-money">{formatFcfa(totaux.credit)}</td>
                  <td className="mono col-money">{formatFcfa(totaux.soldeDebiteur)}</td>
                  <td className="mono col-money">{formatFcfa(totaux.soldeCrediteur)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

type LigneBilanUi = { libelle: string; montant: number; fiable: boolean; note?: string };
type BilanResult = {
  asOf: string;
  actif: LigneBilanUi[];
  passif: LigneBilanUi[];
  totalActif: number;
  totalPassif: number;
  ecart: number;
  equilibre: boolean;
};

type ModuleKey = "capital" | "amortissements" | "comptesTiers" | "stock";

type ParametresComptablesUi = {
  modules: Record<ModuleKey, boolean>;
  capital: number;
  creancesClients: number;
  dettesFournisseurs: number;
  updatedAt: string | null;
  updatedByName: string | null;
  peutActiver: boolean;
};

const MODULES_VIDE: ParametresComptablesUi = {
  modules: {
    capital: false,
    amortissements: false,
    comptesTiers: false,
    stock: false,
  },
  capital: 0,
  creancesClients: 0,
  dettesFournisseurs: 0,
  updatedAt: null,
  updatedByName: null,
  peutActiver: false,
};

/**
 * Modules comptables avancés — grisés pour tout le monde, activables et
 * réglables seulement par le compte direction (marc) : chacun engage un
 * changement de méthode comptable, pas une simple correction opérationnelle.
 */
function ModulesComptablesPanel({ onSaved }: { onSaved: () => void }) {
  const [parametres, setParametres] = useState<ParametresComptablesUi>(MODULES_VIDE);
  const [draft, setDraft] = useState({ capital: "0", creances: "0", dettes: "0" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/parametres-comptables", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      const p = body as ParametresComptablesUi;
      setParametres(p);
      setDraft({
        capital: String(p.capital),
        creances: String(p.creancesClients),
        dettes: String(p.dettesFournisseurs),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(module: ModuleKey) {
    if (!parametres.peutActiver || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/parametres-comptables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modules: { [module]: !parametres.modules[module] },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Modification impossible");
      setParametres(body as ParametresComptablesUi);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modification impossible");
    } finally {
      setSaving(false);
    }
  }

  async function saveMontants() {
    if (!parametres.peutActiver || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/parametres-comptables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capital: Math.round(Number(draft.capital) || 0),
          creancesClients: Math.round(Number(draft.creances) || 0),
          dettesFournisseurs: Math.round(Number(draft.dettes) || 0),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible");
      setParametres(body as ParametresComptablesUi);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  const items: { key: ModuleKey; label: string }[] = [
    { key: "capital", label: "Capital" },
    { key: "amortissements", label: "Amortissements" },
    { key: "comptesTiers", label: "Comptes tiers" },
    { key: "stock", label: "Stock (matières, boissons)" },
  ];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Modules comptables avancés</h2>
        {!loading && !parametres.peutActiver ? (
          <span className="muted">Réservé au compte direction</span>
        ) : null}
      </div>
      {error ? <p className="error-banner" role="alert">{error}</p> : null}
      {loading ? (
        <BrandLoader variant="ligne" label="Chargement des modules…" />
      ) : (
        <>
          <ul className="vente-log">
            {items.map((it) => (
              <li key={it.key}>
                <div>
                  <strong>{it.label}</strong>
                  <div className="vente-log-time muted">
                    {parametres.modules[it.key] ? "Activé" : "Désactivé"}
                  </div>
                </div>
                <button
                  type="button"
                  className={`btn ${parametres.modules[it.key] ? "btn-primary" : "btn-ghost"}`}
                  disabled={!parametres.peutActiver || saving}
                  onClick={() => void toggle(it.key)}
                >
                  {parametres.modules[it.key] ? "Désactiver" : "Activer"}
                </button>
              </li>
            ))}
          </ul>

          {parametres.modules.capital || parametres.modules.comptesTiers ? (
            <div className="immo-form">
              {parametres.modules.capital ? (
                <label className="date-field">
                  <span>Capital (FCFA)</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.capital}
                    disabled={!parametres.peutActiver}
                    onChange={(e) => setDraft((d) => ({ ...d, capital: e.target.value }))}
                  />
                </label>
              ) : null}
              {parametres.modules.comptesTiers ? (
                <>
                  <label className="date-field">
                    <span>Créances clients (FCFA)</span>
                    <input
                      type="number"
                      min={0}
                      value={draft.creances}
                      disabled={!parametres.peutActiver}
                      onChange={(e) => setDraft((d) => ({ ...d, creances: e.target.value }))}
                    />
                  </label>
                  <label className="date-field">
                    <span>Dettes fournisseurs (FCFA)</span>
                    <input
                      type="number"
                      min={0}
                      value={draft.dettes}
                      disabled={!parametres.peutActiver}
                      onChange={(e) => setDraft((d) => ({ ...d, dettes: e.target.value }))}
                    />
                  </label>
                </>
              ) : null}
              {parametres.peutActiver ? (
                <div className="immo-form-actions immo-field-full">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving}
                    onClick={() => void saveMontants()}
                  >
                    {saving ? "Enregistrement…" : "Enregistrer les montants"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {parametres.updatedAt ? (
            <p className="muted">
              Dernière modification : {parametres.updatedByName ?? "—"}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function BilanView({
  asOf,
  setAsOf,
  site,
}: {
  asOf: string;
  setAsOf: (v: string) => void;
  site: "zogbo" | "gbegamey";
}) {
  const [bilan, setBilan] = useState<BilanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ view: "bilan", asOf, site });
      const res = await fetch(`/api/comptabilite?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setBilan(body as BilanResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setBilan(null);
    } finally {
      setLoading(false);
    }
  }, [asOf, site]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="hist-filters">
        <label className="date-field">
          <span>Au</span>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
          Actualiser
        </button>
        {bilan ? (
          <ExportExcelButton onExport={() => exportBilanExcel(bilan)} disabled={loading} />
        ) : null}
      </div>

      <ModulesComptablesPanel onSaved={() => void load()} />

      {error ? <p className="error-banner" role="alert">{error}</p> : null}

      {loading || !bilan ? (
        <BrandLoader variant="ligne" label="Construction du bilan…" />
      ) : (
        <>
          <p className="ui-info" role="note">
            Bilan simplifié : les postes marqués « à vérifier » (capital, stocks, créances, dettes) ne sont
            suivis nulle part dans l&rsquo;application et restent à 0 par construction, jamais estimés — d&rsquo;où
            l&rsquo;écart tant qu&rsquo;un expert-comptable ne les a pas fournis.
          </p>
          <div className="dash-kpi-grid">
            <div className="dash-kpi">
              <span className="dash-kpi-label">Total actif</span>
              <span className="dash-kpi-value">{formatFcfa(bilan.totalActif)}</span>
            </div>
            <div className="dash-kpi">
              <span className="dash-kpi-label">Total passif</span>
              <span className="dash-kpi-value">{formatFcfa(bilan.totalPassif)}</span>
            </div>
            <div className={`dash-kpi${bilan.equilibre ? "" : " dash-kpi-warn"}`}>
              <span className="dash-kpi-label">Écart</span>
              <span className="dash-kpi-value">{formatFcfa(bilan.ecart)}</span>
            </div>
          </div>

          <div className="dash-grid">
            <section className="panel">
              <h2 className="panel-title">Actif</h2>
              <ul className="vente-log">
                {bilan.actif.map((l) => (
                  <li key={l.libelle}>
                    <div>
                      <strong>{l.libelle}</strong>
                      {!l.fiable && l.note ? (
                        <div className="vente-log-time muted">{l.note}</div>
                      ) : null}
                    </div>
                    <span className="mono">{formatFcfa(l.montant)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel">
              <h2 className="panel-title">Passif</h2>
              <ul className="vente-log">
                {bilan.passif.map((l) => (
                  <li key={l.libelle}>
                    <div>
                      <strong>{l.libelle}</strong>
                      {!l.fiable && l.note ? (
                        <div className="vente-log-time muted">{l.note}</div>
                      ) : null}
                    </div>
                    <span className="mono">{formatFcfa(l.montant)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </>
  );
}
