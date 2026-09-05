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
    <div className="equipe-mail">
      <header className="equipe-mail-hero">
        <div>
          <span
            className={`equipe-live-pill${data?.gmailConfigured ? " is-on" : ""}`}
          >
            <span className="equipe-live-dot" aria-hidden />
            {data?.gmailConfigured ? "Gmail branché" : "Gmail non configuré"}
          </span>
          <h2>Alertes mail — ventes</h2>
          <p>
            Destinataires du détail de chaque vente POS, du point de fin de
            journée et du bilan mensuel. Accessible à tous les administrateurs.
          </p>
        </div>
      </header>

      {data && !data.gmailConfigured ? (
        <p className="warn-inline" role="status">
          La liste est enregistrée ; les envois démarreront une fois Gmail
          branché sur le serveur.
        </p>
      ) : null}

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

      <div className="equipe-mail-grid">
        <section className="equipe-mail-panel">
          <h3>Destinataires</h3>
          <form onSubmit={(e) => void addEmail(e)} className="equipe-mail-add">
            <label>
              <span>Nouvel e-mail</span>
              <input
                type="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                placeholder="admin@exemple.com"
                required
                disabled={busy}
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
            <ul className="equipe-mail-list">
              {data.emails.map((addr) => (
                <li key={addr}>
                  <span className="mono">{addr}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
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
            <p className="equipe-mail-env">
              Aussi via serveur (MAIL_ALERT_TO) : {data.envEmails.join(", ")}
            </p>
          ) : null}
        </section>

        <section className="equipe-mail-panel">
          <h3>Envois manuels</h3>
          <p className="muted">
            Utile pour tester la chaîne Gmail ou rattraper un point manqué.
          </p>
          <div className="equipe-mail-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || !data?.gmailConfigured}
              onClick={() => void sendDigestTest("test")}
            >
              Tester l’envoi
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || !data?.gmailConfigured}
              onClick={() => void sendDigestTest("day")}
              title="Envoie le point de la veille (comme le cron de nuit)"
            >
              Point du jour
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || !data?.gmailConfigured}
              onClick={() => void sendDigestTest("month")}
              title="Envoie le bilan du mois précédent"
            >
              Point du mois
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || !data?.gmailConfigured}
              onClick={() => void sendDigestTest("sales")}
              title="Renvoie un mail pour chaque ticket POS valide d’aujourd’hui"
            >
              Renvoyer les ventes du jour
            </button>
          </div>
          <p className="equipe-mail-note">
            Automatique : chaque ticket POS envoie un mail si Gmail est
            configuré. Cron quotidien <code>?kind=day</code> (veille) et le 1er
            du mois <code>?kind=month</code> (mois précédent).
          </p>
        </section>
      </div>
    </div>
  );
}
