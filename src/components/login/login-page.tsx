"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { APP_LOGO, APP_NAME, APP_SITES_LABEL, APP_TAGLINE } from "@/lib/brand";

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      {open ? null : (
        <path
          d="m4 20 16-16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <rect
        x="4.5"
        y="10.5"
        width="15"
        height="9.5"
        rx="2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M7.5 10.5V7.8a4.5 4.5 0 0 1 9 0v2.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        d="M12 21s7-6.4 7-11.8A7 7 0 0 0 5 9.2C5 14.6 12 21 12 21Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.3" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        d="M4 12h15.5M13.5 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false" className="login-spinner">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.28"
        strokeWidth="2.6"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        d="M12 3.5 19 6v5.5c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6l7-2.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m9 12 2.1 2.1L15.5 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        d="M4 16l5-5 4 4 7-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 7h5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <ellipse cx="12" cy="6" rx="7" ry="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
      <div className="login-glow login-glow-a" aria-hidden />
      <div className="login-glow login-glow-b" aria-hidden />

      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <div className="login-logo-ring">
            <img
              src={APP_LOGO}
              alt=""
              className="login-logo"
              width={96}
              height={96}
            />
          </div>
          <h1>{APP_NAME}</h1>
          <p className="login-tagline">{APP_TAGLINE}</p>
          <p className="login-sites">
            <PinIcon />
            {APP_SITES_LABEL}
          </p>
        </div>

        {error ? (
          <p className="login-error" role="alert">
            <span className="login-error-mark" aria-hidden>
              !
            </span>
            {error}
          </p>
        ) : null}

        <label className="login-field">
          <span>Identifiant</span>
          <span className="login-input-shell">
            <span className="login-input-icon" aria-hidden>
              <UserIcon />
            </span>
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </span>
        </label>

        <label className="login-field">
          <span>Mot de passe</span>
          <span className="login-input-shell login-password">
            <span className="login-input-icon" aria-hidden>
              <LockIcon />
            </span>
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="login-reveal"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={
                showPassword
                  ? "Masquer le mot de passe"
                  : "Afficher le mot de passe"
              }
              aria-pressed={showPassword}
            >
              <EyeIcon open={showPassword} />
            </button>
          </span>
        </label>

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
              <ArrowIcon />
            </>
          )}
        </button>

        <div className="login-divider" role="separator">
          <span>ou</span>
        </div>

        <p className="login-foot">
          <LockIcon />
          Accès réservé au personnel
        </p>
      </form>

      <ul className="login-trust" aria-label="Garanties">
        <li>
          <ShieldIcon />
          <span>
            <strong>Sécurisé</strong>
            <em>Connexion protégée</em>
          </span>
        </li>
        <li>
          <TrendIcon />
          <span>
            <strong>Performance</strong>
            <em>Indicateurs en temps réel</em>
          </span>
        </li>
        <li>
          <DatabaseIcon />
          <span>
            <strong>Fiabilité</strong>
            <em>Données synchronisées</em>
          </span>
        </li>
      </ul>
    </div>
  );
}
