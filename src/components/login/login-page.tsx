"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  APP_LOGO,
  APP_SHORT,
  APP_TAGLINE,
} from "@/lib/brand";
import {
  EyeIcon,
  LockIcon,
  ShieldIcon,
  Spinner,
  SubmitArrowIcon,
  UserIcon,
} from "./login-icons";
import { LoginShowcase } from "./login-showcase";

const REMEMBER_KEY = "kingfish-remember-user";

export function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setUsername(saved);
        setRemember(true);
      }
    } catch {
      /* stockage indisponible */
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Connexion impossible");

      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, username.trim());
        else localStorage.removeItem(REMEMBER_KEY);
      } catch {
        /* stockage indisponible */
      }

      const next = searchParams.get("next");
      const target =
        next && next.startsWith("/")
          ? next
          : (body.home as string) || "/";
      router.replace(target);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-layout">
        <section className="login-panel login-panel-form" aria-label="Connexion">
          <div className="login-form-card">
            <div className="login-form-wrap">
            <header className="login-form-head">
              <img
                src={APP_LOGO}
                alt=""
                className="login-form-logo"
                width={64}
                height={64}
              />
              <p className="login-welcome">Bienvenue sur</p>
              <h1 className="login-title">
                {APP_SHORT}{" "}
                <span className="login-title-accent">Manager</span>
              </h1>
              <p className="login-tagline">{APP_TAGLINE}</p>
              <p className="login-secure-badge">
                <ShieldIcon />
                Accès sécurisé
              </p>
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

              <label className="login-field login-field-icon">
                <span className="login-label">Identifiant</span>
                <span className="login-field-leading" aria-hidden>
                  <UserIcon />
                </span>
                <input
                  name="username"
                  placeholder="Votre identifiant"
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

              <label className="login-field login-field-icon login-password">
                <span className="login-label">Mot de passe</span>
                <span className="login-field-leading" aria-hidden>
                  <LockIcon />
                </span>
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Votre mot de passe"
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

              <div className="login-form-options">
                <label className="login-remember">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    disabled={loading}
                  />
                  Se souvenir de moi
                </label>
                <span
                  className="login-forgot"
                  role="note"
                  title="Fonctionnalité à venir — contactez votre administrateur."
                >
                  Mot de passe oublié ?
                </span>
              </div>

              <button
                type="submit"
                className="btn login-submit"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Spinner />
                    Connexion en cours…
                  </>
                ) : (
                  <>
                    Se connecter
                    <SubmitArrowIcon />
                  </>
                )}
              </button>
            </form>

            <p className="login-foot">
              <LockIcon />
              Accès réservé au personnel
            </p>
          </div>
          </div>
        </section>

        <LoginShowcase />
      </div>
    </div>
  );
}
