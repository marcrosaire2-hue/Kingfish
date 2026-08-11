"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import { downloadExcel, excelFilename } from "@/lib/export-excel";
import { formatUpdatedAt, newId } from "@/lib/format";
import type {
  PosCompany,
  PosConfig,
  PosPaymentMethod,
  PosServeur,
  PosTable,
} from "@/lib/types";

type Tab = "tables" | "paiements" | "serveurs" | "entreprise" | "compte";

const TABS: { key: Tab; label: string }[] = [
  { key: "tables", label: "Tables" },
  { key: "paiements", label: "Paiements" },
  { key: "serveurs", label: "Serveurs" },
  { key: "entreprise", label: "Entreprise" },
  { key: "compte", label: "Mon compte" },
];

/** Changement de mot de passe : chacun gère le sien, sans passer par l’admin. */
function PasswordEditor() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next !== confirm) {
      setError("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Changement impossible.");
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Changement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel stack-form" onSubmit={submit}>
      <p className="muted">
        Choisissez un mot de passe d’au moins 8 caractères, différent de
        l’actuel. Il vous sera demandé à la prochaine connexion.
      </p>
      {error ? <p className="error-banner">{error}</p> : null}
      {done ? <p className="login-hint">Mot de passe modifié.</p> : null}
      <label>
        Mot de passe actuel
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </label>
      <label>
        Nouveau mot de passe
        <input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          minLength={8}
        />
      </label>
      <label>
        Confirmer le nouveau mot de passe
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
        />
      </label>
      <button
        type="submit"
        className="btn btn-primary"
        disabled={busy || !current || !next || !confirm}
      >
        {busy ? "Enregistrement…" : "Changer le mot de passe"}
      </button>
    </form>
  );
}

export function ReglagesPage() {
  const [tab, setTab] = useState<Tab>("tables");
  const [data, setData] = useState<PosConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pos-config", { cache: "no-store" });
      const body = (await res.json()) as PosConfig & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setData(body);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function update(next: PosConfig) {
    setData(next);
    setDirty(true);
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/pos-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethods: data.paymentMethods,
          tables: data.tables,
          serveurs: data.serveurs,
          company: data.company,
        }),
      });
      const body = (await res.json()) as PosConfig & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setData(body);
      setDirty(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  const company: PosCompany = data?.company ?? {
    nom: null,
    contacts: null,
    adresse: null,
    activites: null,
  };

  return (
    <AppShell
      title="Réglages POS"
      subtitle="Tables, paiements, serveurs et fiche entreprise"
      actions={
        <>
          <ExportExcelButton
            disabled={!data}
            onExport={() => {
              if (!data) return;
              downloadExcel(excelFilename("reglages-pos"), [
                {
                  name: "Tables",
                  rows: data.tables.map((t) => ({
                    Id: t.id,
                    Référence: t.reference,
                    Emplacement: t.emplacement,
                  })),
                },
                {
                  name: "Paiements",
                  rows: data.paymentMethods.map((p) => ({
                    Id: p.id,
                    Libellé: p.libelle,
                  })),
                },
                {
                  name: "Serveurs",
                  rows: data.serveurs.map((s) => ({
                    Id: s.id,
                    Nom: s.nom,
                  })),
                },
              ]);
            }}
          />
          <button
            type="button"
            className={`btn btn-primary${savedFlash ? " btn-saved" : ""}`}
            disabled={!dirty || saving || !data}
            onClick={() => void save()}
          >
            {saving ? "…" : savedFlash ? "Enregistré" : "Enregistrer"}
          </button>
        </>
      }
    >
      {data?.updatedAt ? (
        <p className="param-meta muted">
          Dernière maj. {formatUpdatedAt(data.updatedAt)}
        </p>
      ) : null}
      {error ? <p className="error-banner">{error}</p> : null}

      <div className="section-tabs" role="tablist" aria-label="Réglages">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`section-tab${tab === t.key ? " is-active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "compte" ? (
        <PasswordEditor />
      ) : loading || !data ? (
        <p className="muted">Chargement…</p>
      ) : tab === "tables" ? (
        <TablesEditor
          rows={data.tables}
          onChange={(tables) => update({ ...data, tables })}
        />
      ) : tab === "paiements" ? (
        <PaymentsEditor
          rows={data.paymentMethods}
          onChange={(paymentMethods) => update({ ...data, paymentMethods })}
        />
      ) : tab === "serveurs" ? (
        <ServeursEditor
          rows={data.serveurs}
          onChange={(serveurs) => update({ ...data, serveurs })}
        />
      ) : (
        <section className="panel stack-form">
          <label>
            Nom de l’entreprise
            <input
              type="text"
              value={company.nom ?? ""}
              onChange={(e) =>
                update({
                  ...data,
                  company: { ...company, nom: e.target.value || null },
                })
              }
            />
          </label>
          <label>
            Contacts
            <input
              type="text"
              value={company.contacts ?? ""}
              onChange={(e) =>
                update({
                  ...data,
                  company: { ...company, contacts: e.target.value || null },
                })
              }
            />
          </label>
          <label>
            Adresse
            <input
              type="text"
              value={company.adresse ?? ""}
              onChange={(e) =>
                update({
                  ...data,
                  company: { ...company, adresse: e.target.value || null },
                })
              }
            />
          </label>
          <label>
            Activités
            <input
              type="text"
              value={company.activites ?? ""}
              onChange={(e) =>
                update({
                  ...data,
                  company: { ...company, activites: e.target.value || null },
                })
              }
            />
          </label>
          <p className="muted">
            Ces infos apparaissent en en-tête à l’impression du ticket POS.
          </p>
        </section>
      )}
    </AppShell>
  );
}

function TablesEditor({
  rows,
  onChange,
}: {
  rows: PosTable[];
  onChange: (rows: PosTable[]) => void;
}) {
  return (
    <section className="panel">
      <table className="data-table">
        <thead>
          <tr>
            <th>Référence</th>
            <th>Emplacement</th>
            <th className="col-actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <input
                  className="name-input"
                  value={row.reference}
                  onChange={(e) =>
                    onChange(
                      rows.map((r) =>
                        r.id === row.id
                          ? { ...r, reference: e.target.value }
                          : r,
                      ),
                    )
                  }
                />
              </td>
              <td>
                <input
                  className="name-input"
                  value={row.emplacement}
                  onChange={(e) =>
                    onChange(
                      rows.map((r) =>
                        r.id === row.id
                          ? { ...r, emplacement: e.target.value }
                          : r,
                      ),
                    )
                  }
                />
              </td>
              <td className="col-actions">
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Supprimer ${row.reference}`}
                  onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-add"
        onClick={() =>
          onChange([
            ...rows,
            {
              id: newId("table"),
              reference: `T${rows.length + 1}`,
              emplacement: "",
            },
          ])
        }
      >
        + Ajouter une table
      </button>
    </section>
  );
}

function PaymentsEditor({
  rows,
  onChange,
}: {
  rows: PosPaymentMethod[];
  onChange: (rows: PosPaymentMethod[]) => void;
}) {
  return (
    <section className="panel">
      <table className="data-table">
        <thead>
          <tr>
            <th>Libellé</th>
            <th className="col-actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <input
                  className="name-input"
                  value={row.libelle}
                  onChange={(e) =>
                    onChange(
                      rows.map((r) =>
                        r.id === row.id
                          ? { ...r, libelle: e.target.value }
                          : r,
                      ),
                    )
                  }
                />
              </td>
              <td className="col-actions">
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Supprimer ${row.libelle}`}
                  onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                  disabled={rows.length <= 1}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-add"
        onClick={() =>
          onChange([
            ...rows,
            { id: newId("pay"), libelle: "Nouveau paiement" },
          ])
        }
      >
        + Ajouter un moyen
      </button>
    </section>
  );
}

function ServeursEditor({
  rows,
  onChange,
}: {
  rows: PosServeur[];
  onChange: (rows: PosServeur[]) => void;
}) {
  return (
    <section className="panel">
      <table className="data-table">
        <thead>
          <tr>
            <th>Nom</th>
            <th className="col-actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <input
                  className="name-input"
                  value={row.nom}
                  onChange={(e) =>
                    onChange(
                      rows.map((r) =>
                        r.id === row.id ? { ...r, nom: e.target.value } : r,
                      ),
                    )
                  }
                />
              </td>
              <td className="col-actions">
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Supprimer ${row.nom}`}
                  onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-add"
        onClick={() =>
          onChange([...rows, { id: newId("srv"), nom: "Nouveau serveur" }])
        }
      >
        + Ajouter un serveur
      </button>
    </section>
  );
}
