"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  APP_NAME,
  APP_SITES_LABEL,
  APP_TAGLINE,
} from "@/lib/brand";
import { BrandIntro, BrandLogoMark } from "@/components/brand-logo-mark";
import { EyeIcon } from "./login-icons";
import { useSession } from "@/components/session-provider";

const REMEMBER_KEY = "kingfish-remember-user";
/** Temps mini d’affichage du logo avant d’entrer dans l’app. */
const LOGO_HOLD_MS = 1400;

export function LoginPage({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const { refresh } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Succès auth : écran logo plein page avant navigation. */
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) setUsername(saved);
    } catch {
      /* stockage indisponible */
    }
  }, []);

  // Session réellement valide (pas le cache) : entrer dans l’app.
  useEffect(() => {
    if (entering) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const body = (await res.json()) as { home?: string };
        const next = nextPath?.trim() || "";
        const isSafeInternalPath = !!next && /^\/(?!\/|\\)/.test(next);
        const target = isSafeInternalPath ? next : body.home || "/";
        router.replace(target);
      } catch {
        /* hors ligne / cookie invalide : rester sur le formulaire */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entering, nextPath, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading || entering) return;
    setLoading(true);
    setEntering(true);
    setError(null);
    const startedAt = Date.now();
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Connexion impossible");

      try {
        localStorage.setItem(REMEMBER_KEY, username.trim());
      } catch {
        /* stockage indisponible */
      }

      const next = nextPath?.trim() || "";
      const isSafeInternalPath = !!next && /^\/(?!\/|\\)/.test(next);
      const target = isSafeInternalPath ? next : (body.home as string) || "/";

      await refresh();

      const wait = Math.max(0, LOGO_HOLD_MS - (Date.now() - startedAt));
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }

      router.replace(target);
      router.refresh();
      setLoading(false);
    } catch (err) {
      setEntering(false);
      setError(err instanceof Error ? err.message : "Connexion impossible");
      setLoading(false);
    }
  }

  if (entering) {
    return (
      <div className="route-loader login-route-loader" role="status" aria-live="polite">
        <BrandIntro hint="Connexion en cours…" />
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card" role="presentation">
        <aside className="login-visual">
          <div className="login-visual-media" aria-hidden />
          <div className="login-visual-shade" aria-hidden />
          <header className="login-visual-top">
            <span className="login-brand">KINGFISH</span>
          </header>
          <footer className="login-visual-foot">
            <div className="login-visual-credit">
              <strong>{APP_NAME}</strong>
              <span>{APP_SITES_LABEL}</span>
            </div>
          </footer>
        </aside>

        <section className="login-panel-form" aria-label="Connexion">
          <div className="login-form-wrap">
            <header className="login-form-head">
              <BrandLogoMark size="md" className="login-form-mark" alt="" />
              <h1 className="login-title">Welcome To KINGFISH</h1>
              <p className="login-form-tag">{APP_TAGLINE}</p>
            </header>

            <form className="login-form" onSubmit={onSubmit} noValidate>
              {error ? (
                <p className="login-error" role="alert" id="login-error">
                  <span className="login-error-mark" aria-hidden>
                    !
                  </span>
                  {error}
                </p>
              ) : null}

              <label className="login-field">
                <span className="sr-only">Identifiant</span>
                <input
                  name="username"
                  placeholder="Identifiant"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  disabled={loading}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "login-error" : undefined}
                />
              </label>

              <label className="login-field login-password">
                <span className="sr-only">Mot de passe</span>
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Mot de passe"
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "login-error" : undefined}
                />
                <button
                  type="button"
                  className="login-reveal"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={loading}
                  aria-label={
                    showPassword
                      ? "Masquer le mot de passe"
                      : "Afficher le mot de passe"
                  }
                  aria-pressed={showPassword}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </label>

              <button
                type="submit"
                className="btn login-submit"
                disabled={loading}
              >
                {loading ? "Connexion…" : "Connexion"}
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
