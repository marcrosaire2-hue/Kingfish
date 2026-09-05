"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { BrandLoader } from "@/components/brand-loader";

type Payload = {
  emails: string[];
  envEmails: string[];
  effective: string[];
  gmailConfigured: boolean;
  error?: string;
};

export function MailAlertsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/mail-alerts", { cache: "no-store" });
      const body = (await res.json()) as Payload;
      if (!res.ok) throw new Error(body.error || "Chargement impossible.");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addEmail(e: FormEvent) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/mail-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", email: email.trim() }),
      });
      const body = (await res.json()) as Payload & {
        added?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Ajout impossible.");
      setData((prev) =>
        prev
          ? {
              ...prev,
              emails: body.emails ?? prev.emails,
              effective: body.effective ?? prev.effective,
            }
          : prev,
      );
      setEmail("");
      setFlash(
        body.added === false
          ? "Cette adresse est déjà dans la liste."
          : "Adresse ajoutée — elle recevra les mails de vente.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ajout impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function removeEmail(addr: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/mail-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", email: addr }),
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Suppression impossible.");
      setData((prev) =>
        prev
          ? {
              ...prev,
              emails: body.emails ?? prev.emails,
              effective: body.effective ?? prev.effective,
            }
          : prev,
      );
      setFlash("Adresse retirée.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function sendDigestTest(kind: "day" | "month" | "test" | "sales") {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch(`/api/mail/cron?kind=${kind}`, {
        method: "POST",
        cache: "no-store",
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        from?: string;
        to?: string;
        total?: number;
        articles?: number;
        sent?: number;
        failed?: number;
        skipped?: number;
        retryAt?: string;
      };
      if (!res.ok) {
        throw new Error(
          body.error ||
            (res.status === 429
              ? "Gmail rate-limit — réessayez dans quelques minutes."
              : "Envoi impossible."),
        );
      }
      if (kind === "test") {
        setFlash("Mail de test envoyé aux destinataires effectifs.");
      } else if (kind === "sales") {
        setFlash(
          `Rattrapage ventes : ${body.sent ?? 0} envoyé(s) / ${body.total ?? 0} ticket(s)` +
            (body.failed ? ` · ${body.failed} échec(s)` : "") +
            (body.skipped ? ` · ${body.skipped} ignoré(s)` : "") +
            ".",
        );
      } else if (body.ok === false) {
        throw new Error(
          body.error ||
            "Envoi non effectué (MAIL_DIGEST_NOTIFY=0, Gmail ou destinataires).",
        );
      } else {
        const period =
          body.from && body.to
            ? body.from === body.to
              ? body.from
              : `${body.from} → ${body.to}`
            : "période";
        setFlash(
          `Point ${kind === "day" ? "journalier" : "mensuel"} envoyé (${period}${
            typeof body.articles === "number"
              ? ` · ${body.articles} art.`
              : ""
          }).`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return <BrandLoader variant="ligne" label="Chargement des alertes mail…" />;
  }

  return (
    <section className="panel" aria-label="Destinataires alertes mail">
      <h2 className="panel-title">Alertes mail — ventes</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Adresses qui reçoivent le détail de chaque vente POS, le{" "}
        <strong>point de fin de journée</strong> (articles, quantités, totaux
        par site) et le <strong>bilan mensuel détaillé</strong>. Réservé au
        compte direction (Marc).
      </p>

      {data && !data.gmailConfigured ? (
        <p className="warn-inline" role="status">
          Gmail n’est pas encore configuré sur le serveur (variables
          d’environnement). La liste est enregistrée, les envois démarreront
          une fois Gmail branché.
        </p>
      ) : null}

      {flash ? (
        <p className="warn-inline" role="status">
          {flash}
        </p>
      ) : null}
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(e) => void addEmail(e)}
        className="admin-mail-add"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.55rem",
          alignItems: "end",
          marginBottom: "1rem",
        }}
      >
        <label
          style={{
            flex: "1 1 14rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.28rem",
          }}
        >
          <span
            style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              letterSpacing: "0.03em",
              textTransform: "uppercase",
              color: "var(--ink-soft)",
            }}
          >
            Nouvel e-mail
          </span>
          <input
            type="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            placeholder="admin@exemple.com"
            required
            disabled={busy}
            style={{
              minHeight: "2.65rem",
              padding: "0.45rem 0.7rem",
              border: "1px solid var(--line)",
              borderRadius: "10px",
              fontSize: 16,
            }}
          />
        </label>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !email.trim()}
        >
          {busy ? "…" : "Ajouter"}
        </button>
      </form>

      {data?.emails.length ? (
        <ul
          className="admin-mail-list"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
          }}
        >
          {data.emails.map((addr) => (
            <li
              key={addr}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.75rem",
                padding: "0.65rem 0.8rem",
                border: "1px solid var(--line)",
                borderRadius: "10px",
                background: "var(--surface)",
              }}
            >
              <span className="mono">{addr}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => void removeEmail(addr)}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Aucune adresse gérée ici pour le moment.</p>
      )}

      {data?.envEmails?.length ? (
        <p className="muted" style={{ marginTop: "1rem", fontSize: "0.86rem" }}>
          Aussi via serveur (MAIL_ALERT_TO) : {data.envEmails.join(", ")}
        </p>
      ) : null}

      <div
        style={{
          marginTop: "1.25rem",
          paddingTop: "1rem",
          borderTop: "1px solid var(--line)",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy || !data?.gmailConfigured}
          onClick={() => void sendDigestTest("test")}
        >
          Tester l’envoi
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy || !data?.gmailConfigured}
          onClick={() => void sendDigestTest("day")}
          title="Envoie le point de la veille (comme le cron de nuit)"
        >
          Envoyer point du jour
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy || !data?.gmailConfigured}
          onClick={() => void sendDigestTest("month")}
          title="Envoie le bilan du mois précédent"
        >
          Envoyer point du mois
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy || !data?.gmailConfigured}
          onClick={() => void sendDigestTest("sales")}
          title="Renvoie un mail pour chaque ticket POS valide d’aujourd’hui"
        >
          Renvoyer mails des ventes du jour
        </button>
      </div>
      <p className="muted" style={{ marginTop: "0.65rem", fontSize: "0.82rem" }}>
        Automatique : chaque ticket POS envoie un mail (si Gmail est configuré ;
        couper avec <code>MAIL_SALE_NOTIFY=0</code>). Cron quotidien{" "}
        <code>?kind=day</code> (veille) et le 1er du mois <code>?kind=month</code>{" "}
        (mois précédent), avec Bearer <code>MAIL_CRON_SECRET</code>.
      </p>
    </section>
  );
}
