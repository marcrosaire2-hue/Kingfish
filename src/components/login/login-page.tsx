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
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <img
            src={APP_LOGO}
            alt=""
            className="login-logo"
            width={96}
            height={96}
          />
          <h1>{APP_NAME}</h1>
          <p className="login-tagline">{APP_TAGLINE}</p>
          <p className="login-sites">{APP_SITES_LABEL}</p>
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
        </label>

        <label className="login-field">
          <span>Mot de passe</span>
          <span className="login-password">
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
          className="btn btn-primary login-submit"
          disabled={loading}
        >
          {loading ? "Connexion…" : "Se connecter"}
        </button>

        <p className="login-foot">Accès réservé au personnel</p>
      </form>
    </div>
  );
}
