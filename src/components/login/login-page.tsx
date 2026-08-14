"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { APP_LOGO, APP_NAME, APP_SITES_LABEL } from "@/lib/brand";

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

/* Le dernier mot du nom passe en graisse légère (« King Fish Manager »). */
const NAME_WORDS = APP_NAME.trim().split(" ");
const NAME_HEAD = NAME_WORDS.slice(0, -1).join(" ");
const NAME_TAIL = NAME_WORDS.length > 1 ? NAME_WORDS[NAME_WORDS.length - 1] : "";

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
      <div className="login-shell">
        <div className="login-brand">
          <span className="login-logo-ring">
            <img
              src={APP_LOGO}
              alt=""
              className="login-logo"
              width={96}
              height={96}
            />
          </span>
          <p className="login-appname">
            <strong>{NAME_HEAD}</strong>
            {NAME_TAIL ? <span>{NAME_TAIL}</span> : null}
          </p>
          <p className="login-sites">
            <PinIcon />
            {APP_SITES_LABEL}
          </p>
        </div>

        <form className="login-form" onSubmit={onSubmit}>
          {error ? (
            <p className="login-error" role="alert">
              <span className="login-error-mark" aria-hidden>
                !
              </span>
              {error}
            </p>
          ) : null}

          <label className="login-field">
            <span className="login-label">Identifiant</span>
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
            />
          </label>

          <label className="login-field login-password">
            <span className="login-label">Mot de passe</span>
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
          </label>

          <button type="submit" className="btn login-submit" disabled={loading}>
            {loading ? (
              <>
                <Spinner />
                Connexion en cours…
              </>
            ) : (
              "Se connecter"
            )}
          </button>
        </form>

        <p className="login-foot">
          <LockIcon />
          Accès réservé au personnel
        </p>
      </div>
    </div>
  );
}
